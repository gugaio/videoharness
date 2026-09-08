package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/models"
	"streammock/internal/store"
)

func TestProxiedURLPreservesFileNameSuffix(t *testing.T) {
	engine := &Engine{}
	base, err := url.Parse("https://origin.example/variants/video-0/master.m3u8")
	if err != nil {
		t.Fatal(err)
	}
	got := engine.proxiedURL("abc", base, "../segments/seg-1.ts")
	if !strings.HasSuffix(got, "~seg-1.ts") {
		t.Fatalf("expected readable file name suffix, got %q", got)
	}
}

func TestReadyCloneServesOnlyRegisteredLocalResources(t *testing.T) {
	directory := t.TempDir()
	database, err := db.Open(filepath.Join(directory, "streammock.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	streams := store.New(database)
	now := time.Now().UTC()
	slug := "ws-clone"
	stream := models.Stream{ID: "clone-test", OriginalURL: "https://origin.example/master.m3u8", ProxyPath: "/s/clone-test/master.m3u8", ActivePreset: "clean", Mode: models.ModeClone, CaptureStatus: models.CaptureQueued, RequestedDurationSeconds: 60, WorkspaceSlug: &slug, CreatedAt: now, UpdatedAt: now}
	if err := streams.Add(stream, true); err != nil {
		t.Fatal(err)
	}
	cloneRoot := filepath.Join(directory, "clones", stream.ID)
	if err := os.MkdirAll(filepath.Join(cloneRoot, "variants", "video-0", "segments"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cloneRoot, "master.m3u8"), []byte("#EXTM3U\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cloneRoot, "variants", "video-0", "segments", "1.ts"), []byte("segment"), 0o644); err != nil {
		t.Fatal(err)
	}
	resources := []models.Resource{
		{StreamID: stream.ID, LogicalPath: "master.m3u8", Kind: "master", ContentType: "application/vnd.apple.mpegurl", SizeBytes: 8, SHA256: "test"},
		{StreamID: stream.ID, LogicalPath: "variants/video-0/segments/1.ts", Kind: "video-segment", ContentType: "video/mp2t", SizeBytes: 7, SHA256: "test"},
	}
	if err := streams.CompleteClone(stream.ID, 6, 15, "clones/clone-test", resources); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	var logged []models.ProxyRequest
	NewEngine(config.Config{StorageDir: directory, HTTPTimeout: time.Second}, streams, NewChaos()).WithRequestSink(func(request models.ProxyRequest) { logged = append(logged, request) }).Register(mux)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, `/s/clone-test/variants/video-0/segments/1.ts?CMCD=sid%3D%22clone-session%22%2Cot%3Dv`, nil))
	if response.Code != http.StatusOK || response.Body.String() != "segment" {
		t.Fatalf("unexpected response: %d %q", response.Code, response.Body.String())
	}
	if len(logged) != 1 || logged[0].CMCD == nil || logged[0].CMCD.SessionID == nil || *logged[0].CMCD.SessionID != "clone-session" || logged[0].LocalServeMS == nil || logged[0].TTFBMS != nil {
		t.Fatalf("clone telemetry should be local and CMCD-correlated: %+v", logged)
	}

	missing := httptest.NewRecorder()
	mux.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/s/clone-test/not-registered.ts", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("got %d for unregistered resource", missing.Code)
	}
}
