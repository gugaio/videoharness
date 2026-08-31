package live

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/models"
)

func TestLivePlaylistRollsAndPausesDeterministically(t *testing.T) {
	manager, stream, now := liveFixture(t)
	state, err := manager.Start(stream, Options{WindowSegments: 3})
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != StatusPlaying || state.Sequence != 100 || state.PlaybackPath != "/s/clone/live.m3u8" {
		t.Fatalf("unexpected initial state: %+v", state)
	}

	master, err := manager.Master(stream)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(master), `URI="live/audio/a/index.m3u8"`) || !strings.Contains(string(master), "live/variants/v/index.m3u8") {
		t.Fatalf("master did not route child playlists through live: %s", master)
	}

	first, err := manager.Media(stream, "variants/v/index.m3u8")
	if err != nil {
		t.Fatal(err)
	}
	for _, segment := range []string{"0.ts", "1.ts", "2.ts"} {
		if !strings.Contains(string(first), segment) {
			t.Fatalf("initial window is missing %s: %s", segment, first)
		}
	}
	if strings.Contains(string(first), "#EXT-X-ENDLIST") {
		t.Fatalf("live playlist must not end: %s", first)
	}

	*now = now.Add(6 * time.Second)
	rolled, err := manager.Media(stream, "variants/v/index.m3u8")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rolled), "#EXT-X-MEDIA-SEQUENCE:101") || strings.Contains(string(rolled), "0.ts") || !strings.Contains(string(rolled), "3.ts") {
		t.Fatalf("window did not roll forward: %s", rolled)
	}

	if _, err := manager.Control(stream, "pause", Options{}); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	paused, err := manager.Media(stream, "variants/v/index.m3u8")
	if err != nil {
		t.Fatal(err)
	}
	if string(paused) != string(rolled) {
		t.Fatalf("paused playlist advanced:\nwant %s\ngot  %s", rolled, paused)
	}
	if _, err := manager.Control(stream, "stop", Options{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Media(stream, "variants/v/index.m3u8"); !errors.Is(err, ErrStopped) {
		t.Fatalf("stopped media error = %v, want ErrStopped", err)
	}
}

func TestNonLoopLiveEndsAtTheStoredContentEnd(t *testing.T) {
	manager, stream, now := liveFixture(t)
	loop := false
	if _, err := manager.Start(stream, Options{WindowSegments: 2, Loop: &loop}); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	body, err := manager.Media(stream, "variants/v/index.m3u8")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "#EXT-X-ENDLIST") || !strings.Contains(string(body), "3.ts") {
		t.Fatalf("non-loop mock must finish at final segment: %s", body)
	}
	state, err := manager.State(stream)
	if err != nil || state.Status != StatusEnded {
		t.Fatalf("ended state = %+v, %v", state, err)
	}
}

func liveFixture(t *testing.T) (*Manager, *models.Stream, *time.Time) {
	t.Helper()
	storage := t.TempDir()
	root := filepath.Join(storage, "clones", "clone")
	if err := os.MkdirAll(filepath.Join(root, "variants", "v"), 0o755); err != nil {
		t.Fatal(err)
	}
	master := "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"English\",URI=\"audio/a/index.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO=\"audio\"\nvariants/v/index.m3u8\n"
	media := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:100\n#EXTINF:6,\nsegments/0.ts\n#EXTINF:6,\nsegments/1.ts\n#EXTINF:6,\nsegments/2.ts\n#EXTINF:6,\nsegments/3.ts\n#EXT-X-ENDLIST\n"
	if err := os.WriteFile(filepath.Join(root, "master.m3u8"), []byte(master), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "variants", "v", "index.m3u8"), []byte(media), 0o644); err != nil {
		t.Fatal(err)
	}
	key := "clones/clone"
	now := time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)
	manager := NewManager(storage)
	manager.now = func() time.Time { return now }
	return manager, &models.Stream{ID: "clone", Mode: models.ModeClone, Format: models.FormatHLS, ProtectionMode: models.ProtectionClear, CaptureStatus: models.CaptureReady, StorageKey: &key}, &now
}
