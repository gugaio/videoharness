package db

import (
	"path/filepath"
	"testing"
	"time"

	"streammock/internal/models"
)

func TestStreamCloneFieldsSurviveRoundTrip(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "streammock.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	stream := models.Stream{ID: "clone", OriginalURL: "https://origin.example/master.m3u8", ProxyPath: "/s/clone/master.m3u8", ActivePreset: "clean", Mode: models.ModeClone, CaptureStatus: models.CaptureQueued, RequestedDurationSeconds: 60, SourceLive: true, CreatedAt: now, UpdatedAt: now}
	if err := database.InsertStream(stream); err != nil {
		t.Fatal(err)
	}
	rows, err := database.ListStreams()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d streams", len(rows))
	}
	if got := rows[0]; got.Mode != models.ModeClone || got.CaptureStatus != models.CaptureQueued || got.RequestedDurationSeconds != 60 || !got.SourceLive {
		t.Fatalf("unexpected stream: %#v", got)
	}
}

func TestPlaybackInspectorMigrationPreservesLegacyRequestHistory(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	_, err = database.conn.Exec(`CREATE TABLE proxy_requests (
		id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_slug TEXT NOT NULL, stream_id TEXT NOT NULL, kind TEXT NOT NULL,
		target_url TEXT NOT NULL, status INTEGER NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
		client_ip TEXT NOT NULL DEFAULT '', active_preset TEXT NOT NULL DEFAULT '', hit_count INTEGER NOT NULL DEFAULT 1,
		first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(workspace_slug, stream_id, target_url));
		INSERT INTO proxy_requests (workspace_slug, stream_id, kind, target_url, status, first_seen_at, last_seen_at)
		VALUES ('ws-legacy', 'stream-legacy', 'segment', 'https://origin/old.ts', 200, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(); err != nil {
		t.Fatalf("migration is not idempotent: %v", err)
	}
	rows, err := database.ListProxyRequests("ws-legacy", models.ModeProxy, "stream-legacy", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TargetURL != "https://origin/old.ts" {
		t.Fatalf("legacy history lost: %+v", rows)
	}
	for _, table := range []string{"playback_sessions", "request_cmcd", "playback_events"} {
		var count int
		if err := database.conn.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Errorf("table %s was not created", table)
		}
	}
	columns := map[string]bool{}
	pragma, err := database.conn.Query(`PRAGMA table_info(proxy_requests)`)
	if err != nil {
		t.Fatal(err)
	}
	for pragma.Next() {
		var cid, notNull, pk int
		var name, kind string
		var defaultValue any
		if err := pragma.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		columns[name] = true
	}
	pragma.Close()
	for _, name := range []string{"started_at_ms", "completed_at_ms", "ttfb_ms", "relay_ms", "origin_body_ms", "connection_reused"} {
		if !columns[name] {
			t.Errorf("column %s missing", name)
		}
	}
}
