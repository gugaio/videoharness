package proxy

import (
	"encoding/base64"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/models"
)

type zeroRandomSource struct{}

func (zeroRandomSource) Int63() int64 { return 0 }
func (zeroRandomSource) Seed(int64)   {}

func instantDeterministicChaos() *Chaos {
	return &Chaos{
		rng:   rand.New(zeroRandomSource{}),
		sleep: func(time.Duration) {},
	}
}

func configForProxyEngine() config.Config {
	return config.Config{HTTPTimeout: 2 * time.Second, TruncateSeconds: 60}
}

func TestRequestSinkCapturesWorkspacePlayback(t *testing.T) {
	base := upstreamFixture(t)
	streams := newTestStreamStore(t)
	slug := "ws-test"
	stream := newEphemeralProxyStream("od-ws-log", base, 60)
	stream.WorkspaceSlug = &slug
	if err := streams.Add(stream, false); err != nil {
		t.Fatal(err)
	}

	var logged []models.ProxyRequest
	engine := NewEngine(configForProxyEngine(), streams, NewChaos()).WithRequestSink(func(req models.ProxyRequest) {
		logged = append(logged, req)
	})
	mux := http.NewServeMux()
	engine.Register(mux)

	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/od-ws-log/master.m3u8", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("master status %d: %s", resp.Code, resp.Body.String())
	}
	if len(logged) != 1 || logged[0].Kind != models.KindMaster {
		t.Fatalf("master request not logged as master: %+v", logged)
	}
	if logged[0].WorkspaceSlug != slug || logged[0].Status != http.StatusOK || logged[0].Bytes == 0 {
		t.Fatalf("unexpected master record: %+v", logged[0])
	}

	// Upstream returns 404 for segments: the recorded status must follow.
	missing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer missing.Close()

	seg := newEphemeralProxyStream("od-ws-seg", missing.URL+"/seg0.ts", 60)
	seg.WorkspaceSlug = &slug
	if err := streams.Add(seg, false); err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString([]byte(missing.URL + "/seg0.ts"))
	resp = httptest.NewRecorder()
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/od-ws-seg/r/"+encoded, nil))
	if resp.Code != http.StatusNotFound {
		t.Fatalf("segment status %d", resp.Code)
	}
	last := logged[len(logged)-1]
	if last.Kind != models.KindSegment || last.Status != http.StatusNotFound {
		t.Fatalf("segment record: kind=%q status=%d, want segment/404", last.Kind, last.Status)
	}
}

func TestPublicStreamsAreNotLogged(t *testing.T) {
	base := upstreamFixture(t)
	streams := newTestStreamStore(t)
	if err := streams.Add(newEphemeralProxyStream("od-anon", base, 60), false); err != nil {
		t.Fatal(err)
	}
	calls := 0
	engine := NewEngine(configForProxyEngine(), streams, NewChaos()).WithRequestSink(func(models.ProxyRequest) { calls++ })
	mux := http.NewServeMux()
	engine.Register(mux)

	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/od-anon/master.m3u8", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("status %d", resp.Code)
	}
	if calls != 0 {
		t.Fatalf("public stream should not be logged, got %d records", calls)
	}
}

func TestRequestSinkCapturesInjectedCDNError(t *testing.T) {
	streams := newTestStreamStore(t)
	slug := "ws-cdn"
	stream := newEphemeralProxyStream("od-cdn", "https://origin.example/master.m3u8", 60)
	stream.WorkspaceSlug = &slug
	stream.ActivePreset = presetCDNDegradation
	if err := streams.Add(stream, false); err != nil {
		t.Fatal(err)
	}

	var logged []models.ProxyRequest
	engine := NewEngine(configForProxyEngine(), streams, instantDeterministicChaos()).WithRequestSink(func(req models.ProxyRequest) {
		logged = append(logged, req)
	})
	mux := http.NewServeMux()
	engine.Register(mux)

	target := "https://origin.example/seg0.ts"
	encoded := base64.RawURLEncoding.EncodeToString([]byte(target))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/od-cdn/r/"+encoded, nil))

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want injected 500", resp.Code)
	}
	if len(logged) != 1 {
		t.Fatalf("logged %d requests, want 1", len(logged))
	}
	got := logged[0]
	if got.Intervention != "http_error" || got.InjectedStatus != http.StatusInternalServerError || got.AddedLatencyMS != 0 {
		t.Fatalf("unexpected CDN intervention: %+v", got)
	}
}

func TestRequestSinkCapturesArtificialManifestLatency(t *testing.T) {
	base := upstreamFixture(t)
	streams := newTestStreamStore(t)
	slug := "ws-stale"
	stream := newEphemeralProxyStream("od-stale", base, 60)
	stream.WorkspaceSlug = &slug
	stream.ActivePreset = presetStaleLiveManifest
	if err := streams.Add(stream, false); err != nil {
		t.Fatal(err)
	}

	var logged []models.ProxyRequest
	engine := NewEngine(configForProxyEngine(), streams, instantDeterministicChaos()).WithRequestSink(func(req models.ProxyRequest) {
		logged = append(logged, req)
	})
	mux := http.NewServeMux()
	engine.Register(mux)

	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/od-stale/master.m3u8", nil))

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.Code)
	}
	if len(logged) != 1 {
		t.Fatalf("logged %d requests, want 1", len(logged))
	}
	got := logged[0]
	if got.Intervention != "latency" || got.AddedLatencyMS != 4000 || got.InjectedStatus != 0 {
		t.Fatalf("unexpected latency intervention: %+v", got)
	}
}
