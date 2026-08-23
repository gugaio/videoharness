package capture

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"streammock/internal/config"
	"streammock/internal/models"
	"streammock/internal/store"
)

const (
	defaultDurationSeconds       = 60.0
	maxDurationSeconds           = 300.0
	maxManifestBytes       int64 = 1 << 20
	maxResourceBytes       int64 = 64 << 20
)

type Manager struct {
	cfg     config.Config
	store   *store.MemoryStore
	source  *sourceClient
	queue   chan string
	mu      sync.Mutex
	pending map[string]struct{}
}

func NewManager(cfg config.Config, streams *store.MemoryStore) *Manager {
	return &Manager{cfg: cfg, store: streams, source: newSourceClient(cfg.HTTPTimeout), queue: make(chan string, 64), pending: make(map[string]struct{})}
}

func (m *Manager) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case id := <-m.queue:
				m.capture(ctx, id)
				m.mu.Lock()
				delete(m.pending, id)
				m.mu.Unlock()
			}
		}
	}()
	for _, stream := range m.store.All() {
		if stream.Mode == models.ModeClone && (stream.CaptureStatus == models.CaptureQueued || stream.CaptureStatus == models.CaptureCapturing) {
			m.Enqueue(stream.ID)
		}
	}
}

func (m *Manager) Enqueue(id string) {
	m.mu.Lock()
	if _, ok := m.pending[id]; ok {
		m.mu.Unlock()
		return
	}
	m.pending[id] = struct{}{}
	m.mu.Unlock()
	select {
	case m.queue <- id:
	default:
		go func() { m.queue <- id }()
	}
}

func ValidateDuration(value float64) (float64, error) {
	if value == 0 {
		return defaultDurationSeconds, nil
	}
	if value < 1 || value > maxDurationSeconds {
		return 0, fmt.Errorf("duration_seconds must be between 1 and 300")
	}
	return value, nil
}

func (m *Manager) capture(ctx context.Context, id string) {
	stream, ok := m.store.Get(id)
	if !ok || stream.Mode != models.ModeClone {
		return
	}
	if err := m.store.MarkCapturing(id); err != nil {
		return
	}
	stagingRoot := filepath.Join(m.cfg.StorageDir, "staging")
	if err := os.MkdirAll(stagingRoot, 0o755); err != nil {
		_ = m.store.FailClone(id, "STORAGE_FAILED", err.Error())
		return
	}
	workspace, err := os.MkdirTemp(stagingRoot, id+"-")
	if err != nil {
		_ = m.store.FailClone(id, "STORAGE_FAILED", err.Error())
		return
	}
	defer os.RemoveAll(workspace)

	result, err := m.materialize(ctx, *stream, workspace)
	if err != nil {
		_ = m.store.FailClone(id, sourceErrorCode(err), safeError(err))
		return
	}
	final := filepath.Join(m.cfg.StorageDir, "clones", id)
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		_ = m.store.FailClone(id, "STORAGE_FAILED", err.Error())
		return
	}
	if err := os.RemoveAll(final); err != nil {
		_ = m.store.FailClone(id, "STORAGE_FAILED", err.Error())
		return
	}
	if err := os.Rename(workspace, final); err != nil {
		_ = m.store.FailClone(id, "STORAGE_FAILED", err.Error())
		return
	}
	if err := m.store.CompleteClone(id, result.duration, result.totalBytes, filepath.ToSlash(filepath.Join("clones", id)), result.resources); err != nil {
		_ = os.RemoveAll(final)
		_ = m.store.FailClone(id, "DATABASE_FAILED", err.Error())
	}
}

type materialized struct {
	duration   float64
	totalBytes int64
	resources  []models.Resource
}
type target struct {
	id, kind string
	media    playlist
	variant  *variant
	audio    *audioRendition
}

func (m *Manager) materialize(ctx context.Context, stream models.Stream, workspace string) (materialized, error) {
	rootBytes, rootURL, err := m.source.text(ctx, stream.OriginalURL, maxManifestBytes)
	if err != nil {
		return materialized{}, err
	}
	root, err := parsePlaylist(string(rootBytes), rootURL)
	if err != nil {
		return materialized{}, err
	}
	duration, err := ValidateDuration(stream.RequestedDurationSeconds)
	if err != nil {
		return materialized{}, err
	}

	var videoURL string
	var selectedVariant *variant
	var selectedAudio *audioRendition
	if root.master {
		best := root.variants[0]
		for _, candidate := range root.variants[1:] {
			if candidate.bandwidth > best.bandwidth {
				best = candidate
			}
		}
		selectedVariant = &best
		videoURL = best.url
		selectedAudio = chooseAudio(root.audio, best.audioGroupID)
	} else {
		videoURL = rootURL.String()
	}
	videoBytes, videoURLBase, err := m.source.text(ctx, videoURL, maxManifestBytes)
	if err != nil {
		return materialized{}, err
	}
	video, err := parsePlaylist(string(videoBytes), videoURLBase)
	if err != nil {
		return materialized{}, err
	}
	if video.master {
		return materialized{}, unsupported("nested HLS master playlists are not supported")
	}
	videoSegments, actualDuration, err := selectSegments(video, duration)
	if err != nil {
		return materialized{}, err
	}

	targets := []target{{id: "video-0", kind: "video", media: video, variant: selectedVariant}}
	selectedByTarget := map[string][]segment{"video-0": videoSegments}
	if selectedAudio != nil {
		audioBytes, audioURL, err := m.source.text(ctx, selectedAudio.url, maxManifestBytes)
		if err != nil {
			return materialized{}, err
		}
		audioMedia, err := parsePlaylist(string(audioBytes), audioURL)
		if err != nil {
			return materialized{}, err
		}
		if audioMedia.master {
			return materialized{}, unsupported("audio rendition must be an HLS media playlist")
		}
		audioSegments, _, err := selectSegments(audioMedia, duration)
		if err != nil {
			return materialized{}, err
		}
		targets = append(targets, target{id: "audio-0", kind: "audio", media: audioMedia, audio: selectedAudio})
		selectedByTarget["audio-0"] = audioSegments
	}

	var result materialized
	for _, current := range targets {
		localPlaylist, resources, bytes, err := m.downloadTarget(ctx, workspace, stream.ID, current, selectedByTarget[current.id], m.cfg.CloneMaxBytes-result.totalBytes)
		if err != nil {
			return materialized{}, err
		}
		result.resources = append(result.resources, resources...)
		result.totalBytes += bytes
		playlistResource, err := writeResource(workspace, localPlaylist, "media-playlist", "application/vnd.apple.mpegurl", []byte(buildMediaPlaylist(current.media, selectedByTarget[current.id])))
		if err != nil {
			return materialized{}, err
		}
		playlistResource.StreamID = stream.ID
		result.resources = append(result.resources, playlistResource)
		result.totalBytes += playlistResource.SizeBytes
		if result.totalBytes > m.cfg.CloneMaxBytes {
			return materialized{}, &captureError{code: "SOURCE_TOO_LARGE", message: "clone exceeds aggregate size limit"}
		}
	}
	master := buildMasterPlaylist(selectedVariant, selectedAudio)
	masterResource, err := writeResource(workspace, "master.m3u8", "master", "application/vnd.apple.mpegurl", []byte(master))
	if err != nil {
		return materialized{}, err
	}
	masterResource.StreamID = stream.ID
	result.resources = append(result.resources, masterResource)
	result.totalBytes += masterResource.SizeBytes
	if result.totalBytes > m.cfg.CloneMaxBytes {
		return materialized{}, &captureError{code: "SOURCE_TOO_LARGE", message: "clone exceeds aggregate size limit"}
	}
	result.duration = actualDuration
	sort.Slice(result.resources, func(i, j int) bool { return result.resources[i].LogicalPath < result.resources[j].LogicalPath })
	return result, nil
}

func (m *Manager) downloadTarget(ctx context.Context, workspace, streamID string, current target, segments []segment, remaining int64) (string, []models.Resource, int64, error) {
	base := filepath.ToSlash(filepath.Join("variants", current.id))
	if current.kind == "audio" {
		base = filepath.ToSlash(filepath.Join("audio", current.id))
	}
	var resources []models.Resource
	var total int64
	for _, segment := range segments {
		logicalPath := fmt.Sprintf("%s/segments/%d.ts", base, segment.sequence)
		resource, err := m.downloadResource(ctx, workspace, logicalPath, current.kind+"-segment", segment.url, remaining-total)
		if err != nil {
			return "", nil, 0, err
		}
		resource.StreamID = streamID
		resources = append(resources, resource)
		total += resource.SizeBytes
	}
	return base + "/index.m3u8", resources, total, nil
}

func (m *Manager) downloadResource(ctx context.Context, workspace, logicalPath, kind, rawURL string, remaining int64) (models.Resource, error) {
	if remaining <= 0 {
		return models.Resource{}, &captureError{code: "SOURCE_TOO_LARGE", message: "clone exceeds aggregate size limit"}
	}
	response, err := m.source.get(ctx, rawURL)
	if err != nil {
		return models.Resource{}, err
	}
	defer response.Body.Close()
	path, err := safeWorkspacePath(workspace, logicalPath)
	if err != nil {
		return models.Resource{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return models.Resource{}, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return models.Resource{}, err
	}
	hash := sha256.New()
	limit := remaining
	if limit > maxResourceBytes {
		limit = maxResourceBytes
	}
	size, copyErr := copyLimited(io.MultiWriter(file, hash), response.Body, limit)
	closeErr := file.Close()
	if copyErr != nil {
		return models.Resource{}, copyErr
	}
	if closeErr != nil {
		return models.Resource{}, closeErr
	}
	return models.Resource{LogicalPath: logicalPath, Kind: kind, ContentType: "video/mp2t", SizeBytes: size, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func writeResource(workspace, logicalPath, kind, contentType string, content []byte) (models.Resource, error) {
	path, err := safeWorkspacePath(workspace, logicalPath)
	if err != nil {
		return models.Resource{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return models.Resource{}, err
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return models.Resource{}, err
	}
	sum := sha256.Sum256(content)
	return models.Resource{LogicalPath: logicalPath, Kind: kind, ContentType: contentType, SizeBytes: int64(len(content)), SHA256: hex.EncodeToString(sum[:])}, nil
}

func safeWorkspacePath(root, logicalPath string) (string, error) {
	if logicalPath == "" || strings.Contains(logicalPath, "..") {
		return "", fmt.Errorf("invalid clone resource path")
	}
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	path, err := filepath.Abs(filepath.Join(resolvedRoot, filepath.FromSlash(logicalPath)))
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(path, resolvedRoot+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid clone resource path")
	}
	return path, nil
}

func buildMediaPlaylist(media playlist, segments []segment) string {
	lines := []string{"#EXTM3U", "#EXT-X-VERSION:3", fmt.Sprintf("#EXT-X-TARGETDURATION:%d", int(media.targetDuration+0.999999)), fmt.Sprintf("#EXT-X-MEDIA-SEQUENCE:%d", segments[0].sequence)}
	for _, segment := range segments {
		if segment.discontinuity {
			lines = append(lines, "#EXT-X-DISCONTINUITY")
		}
		lines = append(lines, fmt.Sprintf("#EXTINF:%.3f,", segment.duration), fmt.Sprintf("segments/%d.ts", segment.sequence))
	}
	lines = append(lines, "#EXT-X-ENDLIST")
	return strings.Join(lines, "\n") + "\n"
}

func buildMasterPlaylist(video *variant, audio *audioRendition) string {
	lines := []string{"#EXTM3U", "#EXT-X-VERSION:3"}
	if audio != nil {
		attrs := []string{"TYPE=AUDIO", `GROUP-ID="audio"`, `NAME="` + quote(audio.name, "audio") + `"`, `URI="audio/audio-0/index.m3u8"`}
		if audio.language != "" {
			attrs = append(attrs, `LANGUAGE="`+quote(audio.language, "")+`"`)
		}
		attrs = append(attrs, "DEFAULT=YES", "AUTOSELECT=YES")
		lines = append(lines, "#EXT-X-MEDIA:"+strings.Join(attrs, ","))
	}
	attrs := []string{"BANDWIDTH=1"}
	if video != nil {
		if video.bandwidth > 0 {
			attrs[0] = fmt.Sprintf("BANDWIDTH=%d", video.bandwidth)
		}
		if video.resolution != "" {
			attrs = append(attrs, "RESOLUTION="+video.resolution)
		}
		if video.codecs != "" {
			attrs = append(attrs, `CODECS="`+quote(video.codecs, "")+`"`)
		}
	}
	if audio != nil {
		attrs = append(attrs, `AUDIO="audio"`)
	}
	lines = append(lines, "#EXT-X-STREAM-INF:"+strings.Join(attrs, ","), "variants/video-0/index.m3u8")
	return strings.Join(lines, "\n") + "\n"
}

func quote(value, fallback string) string {
	if value == "" {
		value = fallback
	}
	return strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`)
}
func safeError(err error) string {
	return strings.TrimSpace(err.Error())[:min(len(strings.TrimSpace(err.Error())), 500)]
}
func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
