package proxy

import (
	"bytes"
	"encoding/base64"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/models"
)

func TestCMCDIsCapturedCorrelatedAndNeverForwarded(t *testing.T) {
	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "1")
	var upstreamCMCD []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCMCD = append(upstreamCMCD, r.URL.Query().Get("CMCD"))
		if strings.HasSuffix(r.URL.Path, "/master.m3u8") {
			_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nvariant.m3u8\n"))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/variant.m3u8") {
			_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST\n"))
			return
		}
		_, _ = w.Write([]byte("segment"))
	}))
	defer upstream.Close()
	streams := newTestStreamStore(t)
	slug := "ws-cmcd"
	stream := newEphemeralProxyStream("cmcd-stream", upstream.URL+"/master.m3u8", 60)
	stream.WorkspaceSlug = &slug
	if err := streams.Add(stream, false); err != nil {
		t.Fatal(err)
	}
	var logged []models.ProxyRequest
	engine := NewEngine(configForProxyEngine(), streams, NewChaos()).WithRequestSink(func(req models.ProxyRequest) { logged = append(logged, req) })
	mux := http.NewServeMux()
	engine.Register(mux)
	cmcdQuery := url.QueryEscape(`br=1200,bl=800,mtp=1800,dl=700,ot=v,sf=h,sid="session-a",su,x-note="ok"`)
	master := httptest.NewRecorder()
	mux.ServeHTTP(master, httptest.NewRequest(http.MethodGet, "/s/cmcd-stream/master.m3u8?CMCD="+cmcdQuery, nil))
	if master.Code != http.StatusOK {
		t.Fatalf("master status %d: %s", master.Code, master.Body.String())
	}
	var resource string
	for _, line := range strings.Split(master.Body.String(), "\n") {
		if strings.HasPrefix(line, "/s/") {
			resource = line
			break
		}
	}
	if resource == "" {
		t.Fatalf("rewritten variant missing from %s", master.Body.String())
	}
	segment := httptest.NewRecorder()
	mux.ServeHTTP(segment, httptest.NewRequest(http.MethodGet, resource+"?CMCD="+cmcdQuery, nil))
	if segment.Code != http.StatusOK {
		t.Fatalf("variant status %d", segment.Code)
	}
	var segmentResource string
	for _, line := range strings.Split(segment.Body.String(), "\n") {
		if strings.HasPrefix(line, "/s/") {
			segmentResource = line
			break
		}
	}
	if segmentResource == "" {
		t.Fatalf("rewritten segment missing from %s", segment.Body.String())
	}
	segment = httptest.NewRecorder()
	mux.ServeHTTP(segment, httptest.NewRequest(http.MethodGet, segmentResource+"?CMCD="+cmcdQuery, nil))
	if segment.Code != http.StatusOK {
		t.Fatalf("segment status %d", segment.Code)
	}
	if len(logged) != 3 {
		t.Fatalf("logged %d requests, want 3", len(logged))
	}
	if logged[0].Kind != models.KindMaster || logged[1].Kind != models.KindVariant || logged[2].Kind != models.KindSegment {
		t.Fatalf("unexpected kinds: %q %q %q", logged[0].Kind, logged[1].Kind, logged[2].Kind)
	}
	for _, req := range logged {
		if req.CMCD == nil || !req.CMCD.Valid || req.CMCD.SessionID == nil || *req.CMCD.SessionID != "session-a" {
			t.Fatalf("CMCD correlation missing: %+v", req.CMCD)
		}
		if req.CMCD.BitrateKbps == nil || *req.CMCD.BitrateKbps != 1200 || req.CMCD.Custom["x-note"].String == nil {
			t.Fatalf("CMCD projection incomplete: %+v", req.CMCD)
		}
	}
	for _, value := range upstreamCMCD {
		if value != "" {
			t.Fatalf("origin received CMCD %q", value)
		}
	}
}

func TestInvalidCMCDFailsOpenAndIsRecorded(t *testing.T) {
	base := upstreamFixture(t)
	streams := newTestStreamStore(t)
	slug := "ws-invalid-cmcd"
	stream := newEphemeralProxyStream("cmcd-invalid", base, 60)
	stream.WorkspaceSlug = &slug
	if err := streams.Add(stream, false); err != nil {
		t.Fatal(err)
	}
	var got models.ProxyRequest
	engine := NewEngine(configForProxyEngine(), streams, NewChaos()).WithRequestSink(func(req models.ProxyRequest) { got = req })
	mux := http.NewServeMux()
	engine.Register(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, `/s/cmcd-invalid/master.m3u8?CMCD=br%3Dnot-a-number%2Csid%3D%22still-correlated%22`, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("invalid telemetry changed playback status to %d", response.Code)
	}
	if got.CMCD == nil || got.CMCD.Valid || len(got.CMCD.ValidationErrors) == 0 {
		t.Fatalf("invalid CMCD was not retained: %+v", got.CMCD)
	}
}

func TestOriginTraceSeparatesTTFBRelayAndConnectionReuse(t *testing.T) {
	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(20 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte("segment"))
	}))
	defer upstream.Close()
	streams := newTestStreamStore(t)
	slug := "ws-trace"
	stream := newEphemeralProxyStream("trace-stream", upstream.URL, 60)
	stream.WorkspaceSlug = &slug
	if err := streams.Add(stream, false); err != nil {
		t.Fatal(err)
	}
	var logged []models.ProxyRequest
	engine := NewEngine(configForProxyEngine(), streams, NewChaos()).WithRequestSink(func(req models.ProxyRequest) { logged = append(logged, req) })
	mux := http.NewServeMux()
	engine.Register(mux)
	encoded := base64.RawURLEncoding.EncodeToString([]byte(upstream.URL + "/seg.ts"))
	for range 2 {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/s/trace-stream/r/"+encoded, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("status %d", response.Code)
		}
	}
	if len(logged) != 2 {
		t.Fatalf("logged=%d", len(logged))
	}
	for _, req := range logged {
		if req.TTFBMS == nil || *req.TTFBMS < 10 || req.RelayMS == nil || *req.RelayMS < 10 || req.OriginBodyMS == nil || *req.OriginBodyMS < 10 {
			t.Fatalf("missing causal phases: %+v", req)
		}
	}
	if logged[1].ConnectionReused == nil || !*logged[1].ConnectionReused {
		t.Fatalf("second connection not marked reused: %+v", logged[1])
	}
	if logged[1].ConnectMS != nil || logged[1].TLSMS != nil {
		t.Fatalf("reused connection invented phases: %+v", logged[1])
	}
}

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

func TestRequestSinkCapturesSubwayBandwidth(t *testing.T) {
	streams := newTestStreamStore(t)
	slug := "ws-subway"
	stream := newEphemeralProxyStream("od-subway", "https://origin.example/master.m3u8", 60)
	stream.WorkspaceSlug = &slug
	stream.ActivePreset = presetSubway3G
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
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/od-subway/r/"+encoded, nil))

	if resp.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want injected 504", resp.Code)
	}
	if len(logged) != 1 {
		t.Fatalf("logged %d requests, want 1", len(logged))
	}
	got := logged[0]
	if got.Intervention != "bandwidth_latency_and_http_error" || got.InjectedStatus != http.StatusGatewayTimeout || got.AddedLatencyMS != 100 || got.Diagnostic == "" {
		t.Fatalf("unexpected subway intervention: %+v", got)
	}
}

type boundedSource struct{ value int64 }

func (s *boundedSource) Int63() int64 { return s.value }
func (s *boundedSource) Seed(int64)   {}

func TestSubway3GShapesBandwidthWithoutInjecting(t *testing.T) {
	c := &Chaos{rng: rand.New(&boundedSource{value: int64(1) << 62}), sleep: func(time.Duration) {}}

	effect := c.Apply(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/seg0.ts", nil), false, presetSubway3G)
	if effect.injectedStatus != 0 {
		t.Fatalf("unexpected injected status %d", effect.injectedStatus)
	}
	if effect.bytesPerSecond < 150_000 || effect.bytesPerSecond > 300_000 {
		t.Fatalf("shaped throughput out of range: %d", effect.bytesPerSecond)
	}
	if effect.addedLatency < 100*time.Millisecond || effect.addedLatency > 400*time.Millisecond {
		t.Fatalf("added latency out of range: %v", effect.addedLatency)
	}
	if got := effect.intervention(); got != "bandwidth_latency" {
		t.Fatalf("intervention = %q, want bandwidth_latency", got)
	}

	manifest := c.Apply(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/master.m3u8", nil), true, presetSubway3G)
	if manifest.bytesPerSecond != 0 || manifest.addedLatency != 0 || manifest.injectedStatus != 0 {
		t.Fatalf("manifests must bypass subway_3g: %+v", manifest)
	}
}

func TestStatusWriterPacesBody(t *testing.T) {
	rec := httptest.NewRecorder()
	sw := &statusWriter{ResponseWriter: rec, throttleBPS: 512 * 1024}
	payload := bytes.Repeat([]byte{0}, 256*1024)

	start := time.Now()
	_, _ = sw.Write(payload[:len(payload)/2])
	_, _ = sw.Write(payload[len(payload)/2:])
	elapsed := time.Since(start)

	if sw.bytes != int64(len(payload)) {
		t.Fatalf("bytes = %d, want %d", sw.bytes, len(payload))
	}
	if elapsed < 200*time.Millisecond {
		t.Fatalf("throttled body finished in %v, pacing did not engage", elapsed)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("throttled body took %v, pacing overshoot", elapsed)
	}
}
