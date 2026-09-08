package proxy

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/live"
	"streammock/internal/models"
)

func TestLiveRoutesServeRollingPlaylistsAndLocalAssets(t *testing.T) {
	storage := t.TempDir()
	streams := newTestStreamStore(t)
	now := time.Now().UTC()
	stream := models.Stream{ID: "live-clone", Mode: models.ModeClone, Format: models.FormatHLS, ProtectionMode: models.ProtectionClear, CaptureStatus: models.CaptureQueued, ActivePreset: "clean", CreatedAt: now, UpdatedAt: now}
	if err := streams.Add(stream, true); err != nil {
		t.Fatal(err)
	}
	key := filepath.ToSlash(filepath.Join("clones", stream.ID))
	root := filepath.Join(storage, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Join(root, "variants", "v", "segments"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "master.m3u8"), []byte("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvariants/v/index.m3u8\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "variants", "v", "index.m3u8"), []byte("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:5,\nsegments/0.ts\n#EXTINF:5,\nsegments/1.ts\n#EXTINF:5,\nsegments/2.ts\n#EXT-X-ENDLIST\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "variants", "v", "segments", "0.ts"), []byte("segment zero"), 0o644); err != nil {
		t.Fatal(err)
	}
	resources := []models.Resource{
		{StreamID: stream.ID, LogicalPath: "master.m3u8", Kind: "master", ContentType: "application/vnd.apple.mpegurl"},
		{StreamID: stream.ID, LogicalPath: "variants/v/index.m3u8", Kind: "media-playlist", ContentType: "application/vnd.apple.mpegurl"},
		{StreamID: stream.ID, LogicalPath: "variants/v/segments/0.ts", Kind: "video", ContentType: "video/mp2t"},
	}
	if err := streams.CompleteCloneWithMetadata(stream.ID, 15, 12, key, resources, false, 1, 0, 0); err != nil {
		t.Fatal(err)
	}
	ready, ok := streams.Get(stream.ID)
	if !ok {
		t.Fatal("ready clone missing")
	}
	engine := NewEngine(config.Config{StorageDir: storage, HTTPTimeout: time.Second}, streams, NewChaos())
	if _, err := engine.Live().Start(ready, live.Options{WindowSegments: 2}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	engine.Register(mux)

	master := httptest.NewRecorder()
	mux.ServeHTTP(master, httptest.NewRequest(http.MethodGet, "/s/live-clone/live.m3u8", nil))
	if master.Code != http.StatusOK || !strings.Contains(master.Body.String(), "live/variants/v/index.m3u8") {
		t.Fatalf("live master: %d %s", master.Code, master.Body.String())
	}
	playlist := httptest.NewRecorder()
	mux.ServeHTTP(playlist, httptest.NewRequest(http.MethodGet, "/s/live-clone/live/variants/v/index.m3u8", nil))
	if playlist.Code != http.StatusOK || strings.Contains(playlist.Body.String(), "#EXT-X-ENDLIST") || !strings.Contains(playlist.Body.String(), "#EXT-X-MEDIA-SEQUENCE:7") {
		t.Fatalf("live rendition: %d %s", playlist.Code, playlist.Body.String())
	}
	asset := httptest.NewRecorder()
	mux.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/s/live-clone/live/variants/v/segments/0.ts", nil))
	if asset.Code != http.StatusOK || asset.Body.String() != "segment zero" {
		t.Fatalf("live asset: %d %s", asset.Code, asset.Body.String())
	}
}
