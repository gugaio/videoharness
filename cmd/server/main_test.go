package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/proxy"
	"streammock/internal/ratelimit"
	"streammock/internal/store"
)

func newOnDemandFixture(t *testing.T, upstreamURL string) http.Handler {
	t.Helper()
	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "1")
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	mem := store.New(database)
	engine := proxy.NewEngine(config.Config{HTTPTimeout: 2 * time.Second, TruncateSeconds: 60}, mem, proxy.NewChaos())
	srv := &Server{
		cfg:     config.Config{},
		store:   mem,
		engine:  engine,
		limiter: ratelimit.New(1000000, 1000000), // effectively disabled
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /p.m3u8", srv.handleOnDemand)
	return mux
}

func TestOnDemandProxiesUpstreamPlaylist(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Write([]byte("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nseg0.ts\n#EXT-X-ENDLIST\n"))
	}))
	defer upstream.Close()

	handler := newOnDemandFixture(t, upstream.URL)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/p.m3u8?url="+upstream.URL+"/master.m3u8", nil))

	if resp.Code != http.StatusOK {
		t.Fatalf("status %d: %s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	wantPrefix := "/s/" + onDemandID(upstream.URL+"/master.m3u8", nil, "clean", 60) + "/r/"
	if !strings.HasPrefix(body, "#EXTM3U") {
		t.Fatalf("body should be an m3u8 playlist:\n%s", body)
	}
	if !strings.Contains(body, wantPrefix) {
		t.Fatalf("segment URI not rewritten through %q:\n%s", wantPrefix, body)
	}
	if got := resp.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("CORS header = %q", got)
	}
}

func TestOnDemandReusesDeterministicIDPerPlaybackConfiguration(t *testing.T) {
	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "1")
	var upstreamHandler http.HandlerFunc = func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("#EXTM3U\n#EXT-X-ENDLIST\n"))
	}
	upstream := httptest.NewServer(upstreamHandler)
	defer upstream.Close()

	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	mem := store.New(database)
	engine := proxy.NewEngine(config.Config{HTTPTimeout: 2 * time.Second}, mem, proxy.NewChaos())
	srv := &Server{store: mem, engine: engine, limiter: ratelimit.New(1000000, 1000000)}
	target := "/p.m3u8?url=" + upstream.URL + "/master.m3u8"

	do := func(url string) *httptest.ResponseRecorder {
		resp := httptest.NewRecorder()
		srv.handleOnDemand(resp, httptest.NewRequest(http.MethodGet, url, nil))
		return resp
	}

	first := do(target)
	if first.Code != http.StatusOK {
		t.Fatalf("first request status %d: %s", first.Code, first.Body.String())
	}
	id := onDemandID(upstream.URL+"/master.m3u8", nil, "clean", 60)
	st, ok := mem.Get(id)
	if !ok || st.ActivePreset != "clean" {
		t.Fatalf("expected default clean preset on reused stream, got %+v", st)
	}
	firstCreatedAt := st.CreatedAt

	presetless := do(target)
	if presetless.Code != http.StatusOK {
		t.Fatalf("repeat status %d", presetless.Code)
	}
	st, _ = mem.Get(id)
	if st.ActivePreset != "clean" {
		t.Fatalf("clean configuration should be reused, got %q", st.ActivePreset)
	}
	if !st.CreatedAt.Equal(firstCreatedAt) {
		t.Fatal("deterministic reuse must preserve CreatedAt")
	}

	explicit := do(target + "&preset=subway_3g")
	if explicit.Code != http.StatusOK {
		t.Fatalf("explicit preset status %d", explicit.Code)
	}
	explicitID := onDemandID(upstream.URL+"/master.m3u8", nil, "subway_3g", 60)
	if explicitID == id {
		t.Fatal("different presets must not share a stream ID")
	}
	st, ok = mem.Get(explicitID)
	if !ok || st.ActivePreset != "subway_3g" {
		t.Fatalf("explicit preset must use an isolated stream, got %+v", st)
	}
	st, _ = mem.Get(id)
	if st.ActivePreset != "clean" {
		t.Fatalf("clean stream must remain unchanged, got %q", st.ActivePreset)
	}

	differentDuration := do(target + "&duration=120")
	if differentDuration.Code != http.StatusOK {
		t.Fatalf("different duration status %d", differentDuration.Code)
	}
	durationID := onDemandID(upstream.URL+"/master.m3u8", nil, "clean", 120)
	if durationID == id {
		t.Fatal("different durations must not share a stream ID")
	}
	st, ok = mem.Get(durationID)
	if !ok || st.RequestedDurationSeconds != 120 {
		t.Fatalf("duration configuration must use an isolated stream, got %+v", st)
	}
}

func TestOnDemandRejectsBadInput(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer upstream.Close()
	handler := newOnDemandFixture(t, upstream.URL)

	cases := []struct{ name, query string }{
		{"missing url", ""},
		{"invalid scheme", "?url=ftp://example.com/a.m3u8"},
		{"with credentials", "?url=https://user:pw@example.com/a.m3u8"},
		{"unknown preset", "?url=" + upstream.URL + "/m.m3u8&preset=nope"},
		{"duration over cap", "?url=" + upstream.URL + "/m.m3u8&duration=301"},
		{"non numeric duration", "?url=" + upstream.URL + "/m.m3u8&duration=abc"},
	}
	for _, tc := range cases {
		resp := httptest.NewRecorder()
		handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/p.m3u8"+tc.query, nil))
		if resp.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", tc.name, resp.Code)
		}
	}
}

func TestOnDemandBlocksPrivateTargetsWithoutOptOut(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	mem := store.New(database)
	engine := proxy.NewEngine(config.Config{HTTPTimeout: 2 * time.Second}, mem, proxy.NewChaos())
	srv := &Server{store: mem, engine: engine, limiter: ratelimit.New(1000000, 1000000)}

	resp := httptest.NewRecorder()
	srv.handleOnDemand(resp, httptest.NewRequest(http.MethodGet, "/p.m3u8?url=http://169.254.169.254/latest/meta-data/", nil))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("private target status %d, want 400 (body %s)", resp.Code, resp.Body.String())
	}
}
