package packager

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var hex128 = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)

var ErrUnavailable = errors.New("shaka packager is not available")

type Track struct {
	Input           string
	Stream          string
	InitSegment     string
	SegmentTemplate string
	PlaylistName    string
	HLSGroupID      string
	HLSName         string
	Language        string
	DRMLabel        string
}

type Request struct {
	WorkDir        string
	Tracks         []Track
	MasterPlaylist string
	MPDOutput      string
	KIDHex         string
	KeyHex         string
	KeyLabel       string
}

type Runner struct {
	Binary  string
	Timeout time.Duration
}

func (r Runner) Run(ctx context.Context, request Request) error {
	if len(request.Tracks) == 0 {
		return errors.New("packager requires at least one track")
	}
	if !hex128.MatchString(request.KIDHex) || !hex128.MatchString(request.KeyHex) {
		return errors.New("packager key ID and key must be 16-byte hex values")
	}
	if request.KeyLabel == "" {
		request.KeyLabel = "STREAMMOCK"
	}
	if strings.ContainsAny(request.KeyLabel, ",:") {
		return errors.New("invalid packager key label")
	}
	args := make([]string, 0, len(request.Tracks)+12)
	for _, track := range request.Tracks {
		descriptor, err := trackDescriptor(track, request.KeyLabel)
		if err != nil {
			return err
		}
		args = append(args, descriptor)
	}
	args = append(args,
		"--enable_raw_key_encryption",
		"--keys", "label="+request.KeyLabel+":key_id="+strings.ToLower(request.KIDHex)+":key="+strings.ToLower(request.KeyHex),
		"--protection_scheme", "cenc",
		"--clear_lead", "0",
		"--hls_playlist_type", "VOD",
		"--hls_master_playlist_output", request.MasterPlaylist,
	)
	if request.MPDOutput != "" {
		args = append(args, "--generate_static_live_mpd", "--mpd_output", request.MPDOutput)
	}
	binary := r.Binary
	if binary == "" {
		binary = "packager"
	}
	if r.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.Timeout)
		defer cancel()
	}
	command := exec.CommandContext(ctx, binary, args...)
	command.Dir = request.WorkDir
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return ErrUnavailable
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("shaka packager timed out: %w", ctx.Err())
		}
		message := strings.TrimSpace(output.String())
		if len(message) > 4096 {
			message = message[len(message)-4096:]
		}
		message = strings.ReplaceAll(message, request.KeyHex, "[redacted]")
		message = strings.ReplaceAll(message, strings.ToUpper(request.KeyHex), "[redacted]")
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("shaka packager failed: %s", message)
	}
	return nil
}

func trackDescriptor(track Track, defaultLabel string) (string, error) {
	if track.Input == "" || track.Stream == "" || track.InitSegment == "" || track.SegmentTemplate == "" || track.PlaylistName == "" {
		return "", errors.New("incomplete packager track descriptor")
	}
	if track.Stream != "video" && track.Stream != "audio" && track.Stream != "text" {
		return "", errors.New("invalid packager stream selector")
	}
	values := []string{"in=" + track.Input, "stream=" + track.Stream, "init_segment=" + track.InitSegment, "segment_template=" + track.SegmentTemplate, "playlist_name=" + track.PlaylistName}
	label := track.DRMLabel
	if label == "" {
		label = defaultLabel
	}
	values = append(values, "drm_label="+label)
	if track.HLSGroupID != "" {
		values = append(values, "hls_group_id="+track.HLSGroupID)
	}
	if track.HLSName != "" {
		values = append(values, "hls_name="+sanitize(track.HLSName))
	}
	if track.Language != "" {
		values = append(values, "language="+sanitize(track.Language))
	}
	return strings.Join(values, ","), nil
}

func sanitize(value string) string {
	return strings.NewReplacer(",", "_", "=", "_", "\n", " ", "\r", " ").Replace(value)
}
