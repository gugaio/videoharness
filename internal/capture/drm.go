package capture

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"streammock/internal/models"
	mediapackager "streammock/internal/packager"
)

func (m *Manager) materializeClearKeyHLS(ctx context.Context, stream models.Stream, workspace string) (materialized, error) {
	if stream.Format != models.FormatHLS {
		return materialized{}, unsupported("ClearKey packaging currently supports HLS sources")
	}
	if m.store == nil {
		return materialized{}, &captureError{code: "DRM_KEY_MISSING", message: "ClearKey material is unavailable"}
	}
	keys, err := m.store.DRMKeys(stream.ID)
	if err != nil || len(keys) != 1 {
		return materialized{}, &captureError{code: "DRM_KEY_MISSING", message: "ClearKey clone requires exactly one content key"}
	}
	inputRoot := filepath.Join(workspace, ".inputs")
	if err := os.MkdirAll(inputRoot, 0o755); err != nil {
		return materialized{}, err
	}
	clearStream := stream
	clearStream.ProtectionMode = models.ProtectionClear
	clearStream.TrackSelection = models.TracksAll
	clearResult, err := m.materialize(ctx, clearStream, inputRoot)
	if err != nil {
		return materialized{}, err
	}
	if err := m.store.SetCaptureProgress(stream.ID, 45); err != nil {
		return materialized{}, err
	}

	metadata, err := readRenditionMetadata(filepath.Join(inputRoot, "master.m3u8"))
	if err != nil {
		return materialized{}, err
	}
	var tracks []mediapackager.Track
	for index := 0; index < clearResult.videoTracks; index++ {
		trackRoot := filepath.Join(inputRoot, "variants", fmt.Sprintf("video-%d", index))
		input := filepath.ToSlash(filepath.Join(".inputs", fmt.Sprintf("video-%d%s", index, packagerInputExtension(trackRoot))))
		if err := concatSegments(trackRoot, filepath.Join(workspace, filepath.FromSlash(input))); err != nil {
			return materialized{}, err
		}
		base := filepath.ToSlash(filepath.Join("variants", fmt.Sprintf("video-%d", index)))
		if err := os.MkdirAll(filepath.Join(workspace, filepath.FromSlash(base), "segments"), 0o755); err != nil {
			return materialized{}, err
		}
		tracks = append(tracks, mediapackager.Track{Input: input, Stream: "video", InitSegment: base + "/init.mp4", SegmentTemplate: base + "/segments/$Number$.m4s", PlaylistName: base + "/index.m3u8", DRMLabel: keys[0].Label})
	}
	for index := 0; index < clearResult.audioTracks; index++ {
		trackRoot := filepath.Join(inputRoot, "audio", fmt.Sprintf("audio-%d", index))
		input := filepath.ToSlash(filepath.Join(".inputs", fmt.Sprintf("audio-%d%s", index, packagerInputExtension(trackRoot))))
		if err := concatSegments(trackRoot, filepath.Join(workspace, filepath.FromSlash(input))); err != nil {
			return materialized{}, err
		}
		base := filepath.ToSlash(filepath.Join("audio", fmt.Sprintf("audio-%d", index)))
		if err := os.MkdirAll(filepath.Join(workspace, filepath.FromSlash(base), "segments"), 0o755); err != nil {
			return materialized{}, err
		}
		name, language := fmt.Sprintf("Audio %d", index+1), ""
		if index < len(metadata.audio) {
			name, language = metadata.audio[index].name, metadata.audio[index].language
		}
		tracks = append(tracks, mediapackager.Track{Input: input, Stream: "audio", InitSegment: base + "/init.mp4", SegmentTemplate: base + "/segments/$Number$.m4s", PlaylistName: base + "/index.m3u8", HLSGroupID: "audio", HLSName: name, Language: language, DRMLabel: keys[0].Label})
	}
	if len(tracks) == 0 {
		return materialized{}, unsupported("source has no packageable audio or video tracks")
	}
	if err := m.packager.Run(ctx, mediapackager.Request{WorkDir: workspace, Tracks: tracks, MasterPlaylist: "master.m3u8", MPDOutput: "manifest.mpd", KIDHex: keys[0].KIDHex, KeyHex: keys[0].KeyHex, KeyLabel: keys[0].Label}); err != nil {
		if errors.Is(err, mediapackager.ErrUnavailable) {
			return materialized{}, &captureError{code: "PACKAGER_UNAVAILABLE", message: "Shaka Packager is required for ClearKey clones"}
		}
		return materialized{}, &captureError{code: "PACKAGING_FAILED", message: err.Error()}
	}
	if err := m.store.SetCaptureProgress(stream.ID, 85); err != nil {
		return materialized{}, err
	}

	if clearResult.subtitleTracks > 0 {
		if err := copyDirectory(filepath.Join(inputRoot, "subtitles"), filepath.Join(workspace, "subtitles")); err != nil {
			return materialized{}, err
		}
		if err := addSubtitlesToPackagedMaster(filepath.Join(workspace, "master.m3u8"), metadata.subtitleLines); err != nil {
			return materialized{}, err
		}
		if err := addSubtitlesToPackagedMPD(filepath.Join(workspace, "manifest.mpd"), inputRoot, metadata.subtitles); err != nil {
			return materialized{}, err
		}
	}
	if err := os.RemoveAll(inputRoot); err != nil {
		return materialized{}, err
	}
	result, err := inventoryWorkspace(workspace, stream.ID, m.cfg.CloneMaxBytes)
	if err != nil {
		return materialized{}, err
	}
	result.duration = clearResult.duration
	result.videoTracks = clearResult.videoTracks
	result.audioTracks = clearResult.audioTracks
	result.subtitleTracks = clearResult.subtitleTracks
	return result, nil
}

func packagerInputExtension(trackRoot string) string {
	if _, err := os.Stat(filepath.Join(trackRoot, "init.mp4")); err == nil {
		return ".mp4"
	}
	return ".ts"
}

type masterMetadata struct {
	audio         []struct{ name, language string }
	subtitleLines []string
	subtitles     []struct{ name, language string }
}

func readRenditionMetadata(path string) (masterMetadata, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return masterMetadata{}, err
	}
	var out masterMetadata
	for _, line := range strings.Split(string(body), "\n") {
		if !strings.HasPrefix(line, "#EXT-X-MEDIA:") {
			continue
		}
		attrs := parseAttributes(strings.TrimPrefix(line, "#EXT-X-MEDIA:"))
		switch strings.ToUpper(attrs["TYPE"]) {
		case "AUDIO":
			out.audio = append(out.audio, struct{ name, language string }{attrs["NAME"], attrs["LANGUAGE"]})
		case "SUBTITLES":
			out.subtitleLines = append(out.subtitleLines, line)
			out.subtitles = append(out.subtitles, struct{ name, language string }{attrs["NAME"], attrs["LANGUAGE"]})
		}
	}
	return out, nil
}

func concatSegments(trackRoot, destination string) error {
	directory := filepath.Join(trackRoot, "segments")
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return numericStem(entries[i].Name()) < numericStem(entries[j].Name()) })
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer output.Close()
	count := 0
	if init, err := os.Open(filepath.Join(trackRoot, "init.mp4")); err == nil {
		_, copyErr := io.Copy(output, init)
		closeErr := init.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		input, err := os.Open(filepath.Join(directory, entry.Name()))
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := input.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		count++
	}
	if count == 0 {
		return errors.New("packageable track has no segments")
	}
	return output.Close()
}

func numericStem(name string) int {
	value, _ := strconv.Atoi(strings.TrimSuffix(name, filepath.Ext(name)))
	return value
}

func copyDirectory(source, destination string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
		if err != nil {
			_ = input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		inputCloseErr := input.Close()
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if inputCloseErr != nil {
			return inputCloseErr
		}
		return closeErr
	})
}

func addSubtitlesToPackagedMaster(path string, mediaLines []string) error {
	if len(mediaLines) == 0 {
		return nil
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	insertAt := 1
	updated := append([]string{}, lines[:insertAt]...)
	updated = append(updated, mediaLines...)
	for _, line := range lines[insertAt:] {
		if strings.HasPrefix(line, "#EXT-X-STREAM-INF:") && !strings.Contains(line, "SUBTITLES=") {
			line += `,SUBTITLES="subtitles"`
		}
		updated = append(updated, line)
	}
	return os.WriteFile(path, []byte(strings.Join(updated, "\n")+"\n"), 0o644)
}

func addSubtitlesToPackagedMPD(path, inputRoot string, subtitles []struct{ name, language string }) error {
	if len(subtitles) == 0 {
		return nil
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	marker := []byte("</Period>")
	position := bytes.LastIndex(body, marker)
	if position < 0 {
		return errors.New("packaged MPD has no Period")
	}
	var addition strings.Builder
	for index, subtitle := range subtitles {
		playlistPath := filepath.Join(inputRoot, "subtitles", fmt.Sprintf("subtitle-%d", index), "index.m3u8")
		playlistBody, err := os.ReadFile(playlistPath)
		if err != nil {
			return err
		}
		base := &url.URL{Scheme: "file", Path: filepath.ToSlash(playlistPath)}
		media, err := parsePlaylist(string(playlistBody), base)
		if err != nil {
			return err
		}
		language := xmlAttribute(subtitle.language)
		name := xmlAttribute(subtitle.name)
		fmt.Fprintf(&addition, `<AdaptationSet id="text-%d" contentType="text" mimeType="text/vtt" lang="%s" segmentAlignment="true"><Label>%s</Label><Representation id="text-%d" bandwidth="256"><SegmentTemplate timescale="1000" media="subtitles/subtitle-%d/segments/$Number$.vtt" startNumber="%d"><SegmentTimeline>`, index, language, name, index, index, media.mediaSequence)
		for _, segment := range media.segments {
			fmt.Fprintf(&addition, `<S d="%d"/>`, int64(segment.duration*1000+0.5))
		}
		addition.WriteString(`</SegmentTimeline></SegmentTemplate></Representation></AdaptationSet>`)
	}
	updated := append([]byte{}, body[:position]...)
	updated = append(updated, []byte(addition.String())...)
	updated = append(updated, body[position:]...)
	return os.WriteFile(path, updated, 0o644)
}

func xmlAttribute(value string) string {
	var out bytes.Buffer
	_ = xml.EscapeText(&out, []byte(value))
	return out.String()
}

func inventoryWorkspace(root, streamID string, maxBytes int64) (materialized, error) {
	var result materialized
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		logical := filepath.ToSlash(relative)
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		kind, contentType := resourceMetadata(logical)
		result.resources = append(result.resources, models.Resource{StreamID: streamID, LogicalPath: logical, Kind: kind, ContentType: contentType, SizeBytes: info.Size(), SHA256: hex.EncodeToString(sum[:])})
		result.totalBytes += info.Size()
		if maxBytes > 0 && result.totalBytes > maxBytes {
			return &captureError{code: "SOURCE_TOO_LARGE", message: "clone exceeds aggregate size limit"}
		}
		return nil
	})
	if err != nil {
		return materialized{}, err
	}
	sort.Slice(result.resources, func(i, j int) bool { return result.resources[i].LogicalPath < result.resources[j].LogicalPath })
	return result, nil
}

func resourceMetadata(path string) (string, string) {
	lower := strings.ToLower(path)
	isAudio := strings.HasPrefix(lower, "audio/")
	switch {
	case lower == "master.m3u8":
		return "master", "application/vnd.apple.mpegurl"
	case lower == "manifest.mpd":
		return "master", "application/dash+xml"
	case strings.HasSuffix(lower, ".m3u8"):
		return "media-playlist", "application/vnd.apple.mpegurl"
	case strings.HasSuffix(lower, ".vtt"):
		return "subtitle-segment", "text/vtt"
	case strings.Contains(lower, "init") && (strings.HasSuffix(lower, ".mp4") || strings.HasSuffix(lower, ".m4s")):
		if isAudio {
			return "asset", "audio/mp4"
		}
		return "asset", "video/mp4"
	case strings.HasSuffix(lower, ".m4s"):
		if isAudio {
			return "segment", "audio/iso.segment"
		}
		return "segment", "video/iso.segment"
	case strings.HasSuffix(lower, ".mp4"):
		return "asset", "video/mp4"
	default:
		return "asset", "application/octet-stream"
	}
}
