package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streammock/internal/db"
	"streammock/internal/ratelimit"
)

func TestObserverIngestIsWriteOnlyDeduplicatedAndOriginScoped(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "observer.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	rawToken := strings.Repeat("a", 48)
	sum := sha256.Sum256([]byte(rawToken))
	session, err := database.CreatePlaybackSession(db.PlaybackSessionCreate{
		WorkspaceSlug: "ws-observer", StreamID: "stream-a", CMCDSessionID: "sid-observer", InitialPreset: "clean",
		TokenHash: hex.EncodeToString(sum[:]), TokenExpiresMS: time.Now().Add(time.Hour).UnixMilli(), AllowedOrigin: "https://player.example",
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{db: database, ingestLimiter: ratelimit.New(100000, 100000)}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /i/{token}/events", srv.handlePlaybackEvents)
	body := `{"events":[{"id":"00000000-0000-4000-8000-000000000001","sequence_number":2,"event_type":"playing","wall_time_ms":1000,"monotonic_ms":20},{"id":"00000000-0000-4000-8000-000000000002","sequence_number":1,"event_type":"session_started","wall_time_ms":900,"monotonic_ms":10}]}`
	do := func(origin string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/i/"+rawToken+"/events", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		return response
	}
	forbidden := do("https://evil.example")
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("foreign origin status=%d", forbidden.Code)
	}
	first := do("https://player.example")
	if first.Code != http.StatusAccepted || !strings.Contains(first.Body.String(), `"accepted":2`) {
		t.Fatalf("first ingest: %d %s", first.Code, first.Body.String())
	}
	second := do("https://player.example")
	if second.Code != http.StatusAccepted || !strings.Contains(second.Body.String(), `"duplicates":2`) {
		t.Fatalf("dedupe ingest: %d %s", second.Code, second.Body.String())
	}
	timeline, err := database.PlaybackTimeline("ws-observer", string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Entries) != 2 || !timeline.Session.ObserverConnected {
		t.Fatalf("events not correlated: %+v", timeline)
	}
	if timeline.Entries[0].Event == nil || timeline.Entries[0].Event.EventType != "session_started" {
		t.Fatalf("out-of-order batch not sorted on timeline: %+v", timeline.Entries)
	}
}

func TestObserverIngestRejectsExpiredTokenWithoutAffectingPlaybackData(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "expired.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	rawToken := strings.Repeat("b", 48)
	sum := sha256.Sum256([]byte(rawToken))
	_, err = database.CreatePlaybackSession(db.PlaybackSessionCreate{WorkspaceSlug: "ws", StreamID: "stream", CMCDSessionID: "sid", InitialPreset: "clean", TokenHash: hex.EncodeToString(sum[:]), TokenExpiresMS: time.Now().Add(-time.Second).UnixMilli()})
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{db: database, ingestLimiter: ratelimit.New(1000, 1000)}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /i/{token}/events", srv.handlePlaybackEvents)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/i/"+rawToken+"/events", strings.NewReader(`{"events":[]}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expired token status=%d", response.Code)
	}
}
