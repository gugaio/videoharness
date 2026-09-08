// Package live turns a stored HLS VOD clone into a small, deterministic live
// source. It deliberately owns no media bytes: playlists are synthesized from
// the clone while segments continue to be served from local storage.
package live

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"streammock/internal/models"
)

const (
	StatusStopped = "stopped"
	StatusPlaying = "playing"
	StatusPaused  = "paused"
	StatusEnded   = "ended"
)

const defaultWindowSegments = 3

var ErrStopped = errors.New("live mock is stopped")

// State is intentionally ephemeral. A restart resets a mock so a test run can
// always begin from a known point.
type State struct {
	Status         string `json:"status"`
	WindowSegments int    `json:"window_segments"`
	Loop           bool   `json:"loop"`
	PlaybackPath   string `json:"playback_path"`
	Sequence       int    `json:"sequence"`
}

type Options struct {
	WindowSegments int
	Loop           *bool
}

type Manager struct {
	storageDir string
	mu         sync.RWMutex
	sessions   map[string]*session
	now        func() time.Time
}

type session struct {
	primary mediaPlaylist
	window  int
	loop    bool
	status  string
	started time.Time
	elapsed time.Duration
}

type mediaPlaylist struct {
	sequence       int
	targetDuration float64
	mapLine        string
	segments       []mediaSegment
}

type mediaSegment struct {
	duration      float64
	uri           string
	discontinuity bool
}

func NewManager(storageDir string) *Manager {
	return &Manager{storageDir: storageDir, sessions: make(map[string]*session), now: time.Now}
}

func PlaybackPath(streamID string) string { return "/s/" + streamID + "/live.m3u8" }

func (m *Manager) Start(st *models.Stream, options Options) (State, error) {
	if err := validStream(st); err != nil {
		return State{}, err
	}
	primary, err := m.loadPrimary(st)
	if err != nil {
		return State{}, err
	}
	window := options.WindowSegments
	if window == 0 {
		window = defaultWindowSegments
	}
	if window < 1 || window > 20 {
		return State{}, errors.New("window_segments must be between 1 and 20")
	}
	loop := true
	if options.Loop != nil {
		loop = *options.Loop
	}
	// Start with a full initial window. This avoids a player beginning with one
	// segment of buffer while still making every following segment clock-driven.
	initial := durationBefore(primary, min(window-1, len(primary.segments)-1))
	m.mu.Lock()
	m.sessions[st.ID] = &session{primary: primary, window: window, loop: loop, status: StatusPlaying, started: m.now(), elapsed: initial}
	state := m.stateLocked(st.ID, m.sessions[st.ID], m.now())
	m.mu.Unlock()
	return state, nil
}

func (m *Manager) Control(st *models.Stream, action string, options Options) (State, error) {
	if err := validStream(st); err != nil {
		return State{}, err
	}
	action = strings.ToLower(strings.TrimSpace(action))
	if action == "start" || action == "restart" {
		return m.Start(st, options)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[st.ID]
	if !ok {
		return m.stoppedState(st.ID), errors.New("live mock has not been started")
	}
	now := m.now()
	s.refresh(now)
	switch action {
	case "pause":
		if s.status == StatusPlaying {
			s.elapsed += now.Sub(s.started)
			s.status = StatusPaused
		}
	case "resume":
		if s.status == StatusPaused {
			s.started = now
			s.status = StatusPlaying
		}
	case "stop":
		delete(m.sessions, st.ID)
		return m.stoppedState(st.ID), nil
	default:
		return m.stateLocked(st.ID, s, now), errors.New("action must be start, pause, resume, restart, or stop")
	}
	return m.stateLocked(st.ID, s, now), nil
}

func (m *Manager) State(st *models.Stream) (State, error) {
	if err := validStream(st); err != nil {
		return State{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[st.ID]
	if !ok {
		return m.stoppedState(st.ID), nil
	}
	s.refresh(m.now())
	return m.stateLocked(st.ID, s, m.now()), nil
}

func (m *Manager) Master(st *models.Stream) ([]byte, error) {
	if _, err := m.active(st); err != nil {
		return nil, err
	}
	body, err := m.read(st, "master.m3u8")
	if err != nil {
		return nil, err
	}
	return []byte(rewriteMaster(string(body))), nil
}

// Media returns a rolling, non-ENDLIST rendition. logicalPath must be one of
// the stored media playlists; assets below /live/ remain ordinary local files.
func (m *Manager) Media(st *models.Stream, logicalPath string) ([]byte, error) {
	s, err := m.active(st)
	if err != nil {
		return nil, err
	}
	body, err := m.read(st, logicalPath)
	if err != nil {
		return nil, err
	}
	playlist, err := parseMedia(string(body))
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	// active returned a session that can have changed while this rendition was
	// read; use the current session if it still exists.
	s = m.sessions[st.ID]
	if s == nil {
		return nil, ErrStopped
	}
	s.refresh(m.now())
	now := m.now()
	position, ended := s.positionAt(s.elapsedAt(now))
	return []byte(renderMedia(playlist, position, s.window, s.loop, ended)), nil
}

func (m *Manager) active(st *models.Stream) (*session, error) {
	if err := validStream(st); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[st.ID]
	if s == nil {
		return nil, ErrStopped
	}
	s.refresh(m.now())
	return s, nil
}

func (m *Manager) stateLocked(id string, s *session, now time.Time) State {
	position, _ := s.positionAt(s.elapsedAt(now))
	return State{Status: s.status, WindowSegments: s.window, Loop: s.loop, PlaybackPath: PlaybackPath(id), Sequence: s.primary.sequence + max(position-s.window+1, 0)}
}

func (m *Manager) stoppedState(id string) State {
	return State{Status: StatusStopped, WindowSegments: defaultWindowSegments, Loop: true, PlaybackPath: PlaybackPath(id)}
}

func (m *Manager) loadPrimary(st *models.Stream) (mediaPlaylist, error) {
	body, err := m.read(st, "master.m3u8")
	if err != nil {
		return mediaPlaylist{}, err
	}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			playlist, err := m.read(st, line)
			if err != nil {
				return mediaPlaylist{}, err
			}
			return parseMedia(string(playlist))
		}
	}
	return mediaPlaylist{}, errors.New("HLS master has no video rendition")
}

func (m *Manager) read(st *models.Stream, logicalPath string) ([]byte, error) {
	if !validPath(logicalPath) || st.StorageKey == nil {
		return nil, errors.New("invalid local HLS resource")
	}
	root := filepath.Join(m.storageDir, filepath.FromSlash(*st.StorageKey))
	full := filepath.Join(root, filepath.FromSlash(logicalPath))
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	cleanFull, err := filepath.Abs(full)
	if err != nil || !strings.HasPrefix(cleanFull, cleanRoot+string(os.PathSeparator)) {
		return nil, errors.New("invalid local HLS resource")
	}
	return os.ReadFile(cleanFull)
}

func validStream(st *models.Stream) error {
	if st == nil || st.Mode != models.ModeClone || st.Format != models.FormatHLS || st.ProtectionMode != models.ProtectionClear || st.CaptureStatus != models.CaptureReady {
		return errors.New("live mocks require a ready, clear HLS clone")
	}
	return nil
}

func validPath(value string) bool {
	if value == "" || len(value) > 512 || path.IsAbs(value) {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func (s *session) refresh(now time.Time) {
	if s.status != StatusPlaying || s.loop {
		return
	}
	_, ended := s.positionAt(s.elapsedAt(now))
	if ended {
		s.elapsed = totalDuration(s.primary)
		s.status = StatusEnded
	}
}

func (s *session) elapsedAt(now time.Time) time.Duration {
	if s.status == StatusPlaying {
		return s.elapsed + now.Sub(s.started)
	}
	return s.elapsed
}

func (s *session) positionAt(elapsed time.Duration) (int, bool) {
	if len(s.primary.segments) == 0 {
		return 0, true
	}
	total := totalDuration(s.primary)
	if !s.loop && elapsed >= total {
		return len(s.primary.segments) - 1, true
	}
	cycles := 0
	if s.loop && total > 0 {
		cycles = int(elapsed / total)
		elapsed %= total
	}
	accumulated := time.Duration(0)
	for index, item := range s.primary.segments {
		accumulated += seconds(item.duration)
		if elapsed < accumulated {
			return cycles*len(s.primary.segments) + index, false
		}
	}
	return len(s.primary.segments) - 1, !s.loop
}

func parseMedia(text string) (mediaPlaylist, error) {
	var out mediaPlaylist
	var pendingDuration float64
	pendingDiscontinuity := false
	for _, raw := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(line, "#EXT-X-TARGETDURATION:"):
			out.targetDuration, _ = strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-TARGETDURATION:")), 64)
		case strings.HasPrefix(line, "#EXT-X-MEDIA-SEQUENCE:"):
			out.sequence, _ = strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-MEDIA-SEQUENCE:")))
		case strings.HasPrefix(line, "#EXT-X-MAP:"):
			out.mapLine = line
		case line == "#EXT-X-DISCONTINUITY":
			pendingDiscontinuity = true
		case strings.HasPrefix(line, "#EXTINF:"):
			value := strings.TrimPrefix(line, "#EXTINF:")
			if comma := strings.IndexByte(value, ','); comma >= 0 {
				value = value[:comma]
			}
			pendingDuration, _ = strconv.ParseFloat(strings.TrimSpace(value), 64)
		case line != "" && !strings.HasPrefix(line, "#"):
			if pendingDuration <= 0 {
				return mediaPlaylist{}, errors.New("invalid stored HLS media playlist")
			}
			out.segments = append(out.segments, mediaSegment{duration: pendingDuration, uri: line, discontinuity: pendingDiscontinuity})
			pendingDuration, pendingDiscontinuity = 0, false
		}
	}
	if len(out.segments) == 0 {
		return mediaPlaylist{}, errors.New("stored HLS media playlist has no segments")
	}
	if out.targetDuration <= 0 {
		for _, item := range out.segments {
			out.targetDuration = math.Max(out.targetDuration, item.duration)
		}
	}
	return out, nil
}

func renderMedia(playlist mediaPlaylist, position, window int, loop, ended bool) string {
	start := max(position-window+1, 0)
	end := position
	if !loop {
		end = min(end, len(playlist.segments)-1)
	}
	lines := []string{"#EXTM3U", "#EXT-X-VERSION:3", fmt.Sprintf("#EXT-X-TARGETDURATION:%d", int(math.Ceil(playlist.targetDuration))), fmt.Sprintf("#EXT-X-MEDIA-SEQUENCE:%d", playlist.sequence+start)}
	if playlist.mapLine != "" {
		lines[1] = "#EXT-X-VERSION:6"
		lines = append(lines, playlist.mapLine)
	}
	for index := start; index <= end; index++ {
		item := playlist.segments[index%len(playlist.segments)]
		if (index > 0 && index%len(playlist.segments) == 0) || item.discontinuity {
			lines = append(lines, "#EXT-X-DISCONTINUITY")
		}
		lines = append(lines, fmt.Sprintf("#EXTINF:%.3f,", item.duration), item.uri)
	}
	if ended && !loop {
		lines = append(lines, "#EXT-X-ENDLIST")
	}
	return strings.Join(lines, "\n") + "\n"
}

func rewriteMaster(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#EXT-X-MEDIA:") {
			lines[i] = rewriteURIAttribute(raw)
		} else if !strings.HasPrefix(line, "#") {
			lines[i] = "live/" + line
		}
	}
	return strings.Join(lines, "\n")
}

func rewriteURIAttribute(line string) string {
	const marker = `URI="`
	start := strings.Index(line, marker)
	if start < 0 {
		return line
	}
	valueStart := start + len(marker)
	end := strings.Index(line[valueStart:], `"`)
	if end < 0 {
		return line
	}
	end += valueStart
	return line[:valueStart] + "live/" + line[valueStart:end] + line[end:]
}

func durationBefore(playlist mediaPlaylist, index int) time.Duration {
	var out time.Duration
	for i := 0; i < index; i++ {
		out += seconds(playlist.segments[i].duration)
	}
	return out
}

func totalDuration(playlist mediaPlaylist) time.Duration {
	return durationBefore(playlist, len(playlist.segments))
}
func seconds(value float64) time.Duration { return time.Duration(value * float64(time.Second)) }
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
