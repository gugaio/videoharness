package db

import (
	"path/filepath"
	"testing"
	"time"

	"streammock/internal/models"
)

func newWorkspaceDB(t *testing.T) *DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	return database
}

func TestEnsureWorkspaceIsIdempotentPerOwner(t *testing.T) {
	database := newWorkspaceDB(t)

	first, err := database.EnsureWorkspace("user_a")
	if err != nil {
		t.Fatal(err)
	}
	second, err := database.EnsureWorkspace("user_a")
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("same owner got different slugs: %q vs %q", first, second)
	}
	other, err := database.EnsureWorkspace("user_b")
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Fatal("different owners must not share a slug")
	}

	owner, ok := database.WorkspaceOwner(first)
	if !ok || owner != "user_a" {
		t.Fatalf("WorkspaceOwner = %q, %v", owner, ok)
	}
	if _, ok := database.WorkspaceOwner("ws-unknown"); ok {
		t.Fatal("unknown slug should not resolve")
	}
}

func TestInsertProxyRequestKeepsRepeats(t *testing.T) {
	database := newWorkspaceDB(t)
	req := models.ProxyRequest{
		WorkspaceSlug: "ws-a", StreamID: "od-1", Kind: models.KindSegment,
		TargetURL: "https://origin/seg0.ts", Status: 200, DurationMS: 120, Bytes: 500,
		ClientIP: "203.0.113.5", ActivePreset: "subway_3g",
	}
	if err := database.InsertProxyRequest(req); err != nil {
		t.Fatal(err)
	}
	second := req
	second.Status = 504
	second.DurationMS = 400
	second.Bytes = 300
	second.ClientIP = "198.51.100.9"
	if err := database.InsertProxyRequest(second); err != nil {
		t.Fatal(err)
	}

	rows, err := database.ListProxyRequests("ws-a", models.ModeProxy, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 history rows, got %d", len(rows))
	}
	got := rows[0]
	if got.HitCount != 1 {
		t.Errorf("hit_count = %d, want 1", got.HitCount)
	}
	if got.Bytes != 300 {
		t.Errorf("bytes = %d, want 300", got.Bytes)
	}
	if got.Status != 504 || got.DurationMS != 400 {
		t.Errorf("latest hit should win: status %d duration %d", got.Status, got.DurationMS)
	}
	if got.ClientIP != "198.51.100.9" {
		t.Errorf("client_ip = %q, want latest", got.ClientIP)
	}

	count, err := database.CountProxyRequests("ws-a", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("total_24h = %d, want 2", count)
	}
}

func TestPurgeAndTrimProxyRequests(t *testing.T) {
	database := newWorkspaceDB(t)
	for i := 0; i < 6; i++ {
		if err := database.InsertProxyRequest(models.ProxyRequest{
			WorkspaceSlug: "ws-trim", StreamID: "od-x", Kind: models.KindSegment,
			TargetURL: "https://origin/seg" + string(rune('a'+i)) + ".ts", Status: 200,
		}); err != nil {
			t.Fatal(err)
		}
	}
	// Age all rows past the TTL.
	if _, err := database.conn.Exec(`UPDATE proxy_requests SET last_seen_at = ?`, time.Now().UTC().Add(-48*time.Hour).Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	purged, err := database.PurgeProxyRequests(24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if purged != 6 {
		t.Fatalf("purge removed %d rows, want 6", purged)
	}

	for i := 0; i < 8; i++ {
		if err := database.InsertProxyRequest(models.ProxyRequest{
			WorkspaceSlug: "ws-trim", StreamID: "od-x", Kind: models.KindSegment,
			TargetURL: "https://origin/new" + string(rune('a'+i)) + ".ts", Status: 200,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := database.TrimProxyRequests(3); err != nil {
		t.Fatal(err)
	}
	rows, err := database.ListProxyRequests("ws-trim", models.ModeProxy, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("after trim got %d rows, want 3", len(rows))
	}
	if rows[0].TargetURL != "https://origin/newh.ts" {
		t.Errorf("newest row = %q, want the last inserted", rows[0].TargetURL)
	}

	// Trimming is per workspace: another workspace's rows survive untouched.
	if err := database.InsertProxyRequest(models.ProxyRequest{
		WorkspaceSlug: "ws-other", StreamID: "od-y", Kind: models.KindMaster,
		TargetURL: "https://origin/master.m3u8", Status: 200,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.TrimProxyRequests(100); err != nil {
		t.Fatal(err)
	}
	kept, err := database.ListProxyRequests("ws-trim", models.ModeProxy, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 3 {
		t.Fatalf("trim of another workspace touched ws-trim: %d rows", len(kept))
	}
	other, err := database.ListProxyRequests("ws-other", models.ModeProxy, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 1 || other[0].TargetURL != "https://origin/master.m3u8" {
		t.Fatalf("ws-other rows damaged: %+v", other)
	}
}
