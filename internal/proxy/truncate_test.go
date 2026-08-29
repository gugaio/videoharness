package proxy

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/config"
	"streammock/internal/db"
	"streammock/internal/models"
	"streammock/internal/store"
)

func newTestStreamStore(t *testing.T) *store.MemoryStore {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	return store.New(database)
}

func newEphemeralProxyStream(id, originalURL string, requestedDuration float64) models.Stream {
	now := time.Now().UTC()
	return models.Stream{
		ID: id, OriginalURL: originalURL,
		ProxyPath: "/s/" + id + "/master.m3u8", ActivePreset: "clean",
		Mode: models.ModeProxy, CaptureStatus: models.CaptureReady,
		RequestedDurationSeconds: requestedDuration, CreatedAt: now, UpdatedAt: now,
	}
}

const fourSegmentPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:30
#EXTINF:30.0,
seg0.ts
#EXTINF:30.0,
seg1.ts
#EXTINF:30.0,
seg2.ts
#EXTINF:30.0,
seg3.ts
#EXT-X-ENDLIST
`

// upstreamFixture spins an origin serving the fixture playlist; private-target
// protection is opted out so the proxy client can reach 127.0.0.1.
func upstreamFixture(t *testing.T) (base string) {
	t.Helper()
	t.Setenv("STREAMMOCK_ALLOW_PRIVATE_TARGETS", "1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		fmt.Fprint(w, fourSegmentPlaylist)
	}))
	t.Cleanup(server.Close)
	return server.URL + "/video.m3u8"
}

func TestTruncationUsesPerStreamDuration(t *testing.T) {
	base := upstreamFixture(t)
	streams := newTestStreamStore(t)
	engine := NewEngine(config.Config{HTTPTimeout: 2 * time.Second, TruncateSeconds: 60}, streams, NewChaos())
	mux := http.NewServeMux()
	engine.Register(mux)

	fetch := func(duration float64) string {
		id := fmt.Sprintf("trunc-%v", duration)
		if err := streams.Add(newEphemeralProxyStream(id, base, duration), false); err != nil {
			t.Fatal(err)
		}
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/"+id+"/master.m3u8", nil))
		if resp.Code != http.StatusOK {
			t.Fatalf("status %d: %s", resp.Code, resp.Body.String())
		}
		return resp.Body.String()
	}

	short := fetch(45)
	if !strings.Contains(short, "seg0.ts") {
		t.Error("first segment must survive a 45s cap")
	}
	for _, seg := range []string{"seg1", "seg2", "seg3"} {
		if strings.Contains(short, seg) {
			t.Errorf("%s must be truncated under a 45s cap", seg)
		}
	}
	if strings.Contains(short, "#EXT-X-ENDLIST\n#EXT-X-ENDLIST") {
		t.Error("exactly one ENDLIST tag expected")
	}

	globalDefault := fetch(0) // falls back to config.TruncateSeconds = 60
	for _, seg := range []string{"seg0", "seg1"} {
		if !strings.Contains(globalDefault, seg) {
			t.Errorf("%s must survive the default 60s cap", seg)
		}
	}
	if strings.Contains(globalDefault, "seg2") {
		t.Error("seg2 must be truncated under the default 60s cap")
	}
}

func TestPlaybackSetsCORSHeadersOnPlaylistsAndSegments(t *testing.T) {
	base := upstreamFixture(t)
	streams := newTestStreamStore(t)
	if err := streams.Add(newEphemeralProxyStream("cors-check", base, 60), false); err != nil {
		t.Fatal(err)
	}
	engine := NewEngine(config.Config{HTTPTimeout: 2 * time.Second, TruncateSeconds: 60}, streams, NewChaos())
	mux := http.NewServeMux()
	engine.Register(mux)

	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/s/cors-check/master.m3u8", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("status %d: %s", resp.Code, resp.Body.String())
	}
	if got := resp.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("playlist CORS header = %q", got)
	}

	preflight := httptest.NewRecorder()
	mux.ServeHTTP(preflight, httptest.NewRequest(http.MethodOptions, "/s/cors-check/master.m3u8", nil))
	if preflight.Code != http.StatusNoContent {
		t.Fatalf("preflight status %d, want 204", preflight.Code)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("preflight CORS header = %q", got)
	}
}
