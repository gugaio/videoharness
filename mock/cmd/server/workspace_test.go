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
	"streammock/internal/models"
	"streammock/internal/proxy"
	"streammock/internal/ratelimit"
	"streammock/internal/store"
)

type workspaceFixture struct {
	handler *http.ServeMux
	store   *store.MemoryStore
	db      *db.DB
	logged  *[]models.ProxyRequest
}

func newWorkspaceFixture(t *testing.T) *workspaceFixture {
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
	var logged []models.ProxyRequest
	engine := proxy.NewEngine(config.Config{HTTPTimeout: 2 * time.Second, TruncateSeconds: 60}, mem, proxy.NewChaos()).
		WithRequestSink(func(req models.ProxyRequest) { logged = append(logged, req) })
	srv := &Server{
		cfg:     config.Config{},
		store:   mem,
		engine:  engine,
		limiter: ratelimit.New(1000000, 1000000),
		db:      database,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/workspace", srv.handleGetWorkspace)
	mux.HandleFunc("GET /api/workspace/requests", srv.handleWorkspaceRequests)
	mux.HandleFunc("GET /ws/{slug}/p.m3u8", srv.handleWorkspaceOnDemand)
	engine.Register(mux)
	return &workspaceFixture{handler: mux, store: mem, db: database, logged: &logged}
}

func TestWorkspaceProxyCreatesTaggedStreamAndLogsRequests(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nseg0.ts\n#EXT-X-ENDLIST\n"))
	}))
	defer upstream.Close()

	fixture := newWorkspaceFixture(t)
	slug, err := fixture.db.EnsureWorkspace("user_1")
	if err != nil {
		t.Fatal(err)
	}
	entry := "/ws/" + slug + "/p.m3u8?url=" + upstream.URL + "/master.m3u8"

	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, entry, nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("workspace entry status %d: %s", resp.Code, resp.Body.String())
	}
	body := resp.Body.String()
	id := onDemandID(upstream.URL+"/master.m3u8", &slug, "clean", 60)
	if !strings.Contains(body, "/s/"+id+"/r/") {
		t.Fatalf("playlist not rewritten through the workspace stream:\n%s", body)
	}
	st, ok := fixture.store.Get(id)
	if !ok {
		t.Fatal("workspace stream missing from store")
	}
	if st.WorkspaceSlug == nil || *st.WorkspaceSlug != slug {
		t.Fatalf("stream not tagged with workspace slug: %+v", st.WorkspaceSlug)
	}
	if len(*fixture.logged) != 1 || (*fixture.logged)[0].Kind != models.KindMaster {
		t.Fatalf("master entry not logged: %+v", *fixture.logged)
	}

	// Follow the rewritten variant/segment URI; it must be attributed too.
	proxied := firstLineWithPrefix(t, body, "/s/"+id+"/r/")
	resp = httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, proxied, nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("proxied resource status %d: %s", resp.Code, resp.Body.String())
	}
	last := (*fixture.logged)[len(*fixture.logged)-1]
	if last.StreamID != id || last.WorkspaceSlug != slug {
		t.Fatalf("proxied record misattributed: %+v", last)
	}
	if last.Kind != models.KindVariant && last.Kind != models.KindSegment {
		t.Fatalf("proxied record kind = %q", last.Kind)
	}
}

func TestWorkspaceEntryRejectsUnknownSlug(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer upstream.Close()
	fixture := newWorkspaceFixture(t)

	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/ws/ws-doesnotexist/p.m3u8?url="+upstream.URL+"/master.m3u8", nil))
	if resp.Code != http.StatusNotFound {
		t.Fatalf("unknown slug status %d, want 404", resp.Code)
	}
	if len(*fixture.logged) != 0 {
		t.Fatal("nothing should be logged for unknown slugs")
	}
}

func TestWorkspaceAPIRequiresAuth(t *testing.T) {
	fixture := newWorkspaceFixture(t)
	for _, path := range []string{"/api/workspace", "/api/workspace/requests"} {
		resp := httptest.NewRecorder()
		fixture.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, path, nil))
		if resp.Code != http.StatusUnauthorized {
			t.Errorf("%s without token: status %d, want 401", path, resp.Code)
		}
	}
}

func firstLineWithPrefix(t *testing.T, body, prefix string) string {
	t.Helper()
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) {
			return line
		}
	}
	t.Fatalf("no line starting with %q in:\n%s", prefix, body)
	return ""
}
