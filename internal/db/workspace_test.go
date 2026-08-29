package db

import (
	"path/filepath"
	"testing"
	"time"

	"streammock/internal/cmcd"
	"streammock/internal/models"
	"streammock/internal/telemetry"
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
		Intervention: "latency", AddedLatencyMS: 1800,
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
	if got.Intervention != "latency" || got.AddedLatencyMS != 1800 || got.InjectedStatus != 0 {
		t.Errorf("intervention fields were not preserved: %+v", got)
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

func TestProxyRequestCMCDSessionAndEventsRoundTrip(t *testing.T) {
	database := newWorkspaceDB(t)
	sid, cid := "cmcd-session-a", "content-a"
	br, mtp, bl, dl := int64(1200), int64(900), int64(800), int64(500)
	startup, starvation := true, false
	base := models.ProxyRequest{
		WorkspaceSlug: "ws-inspector", StreamID: "stream-a", StreamMode: models.ModeProxy, Kind: models.KindSegment,
		TargetURL: "https://origin/seg.ts", Status: 200, DurationMS: 700, Bytes: 100_000, ActivePreset: "clean",
		StartedAtMS: 1_000, CompletedAtMS: 1_700,
		CMCD: &models.RequestCMCD{Version: 1, Valid: true, SessionID: &sid, ContentID: &cid, BitrateKbps: &br, MeasuredThroughputKbps: &mtp, BufferLengthMS: &bl, DeadlineMS: &dl, Startup: &startup, BufferStarvation: &starvation},
	}
	if err := database.InsertProxyRequest(base); err != nil {
		t.Fatal(err)
	}
	second := base
	second.TargetURL = "https://origin/seg2.ts"
	second.StartedAtMS = 2_000
	second.CompletedAtMS = 2_200
	second.DurationMS = 200
	if err := database.InsertProxyRequest(second); err != nil {
		t.Fatal(err)
	}
	var sessionCount, cmcdCount int
	if err := database.conn.QueryRow(`SELECT COUNT(*) FROM playback_sessions`).Scan(&sessionCount); err != nil {
		t.Fatal(err)
	}
	if err := database.conn.QueryRow(`SELECT COUNT(*) FROM request_cmcd`).Scan(&cmcdCount); err != nil {
		t.Fatal(err)
	}
	if sessionCount != 1 || cmcdCount != 2 {
		t.Fatalf("sessions=%d cmcd=%d, want 1/2", sessionCount, cmcdCount)
	}
	rows, err := database.ListProxyRequests("ws-inspector", models.ModeProxy, "stream-a", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].ID == 0 || rows[0].CMCD == nil || rows[0].CMCD.SessionInternalID == nil {
		t.Fatalf("CMCD list round trip failed: %+v", rows)
	}
	sessionID := *rows[0].CMCD.SessionInternalID
	payload := `{"method":"requestVideoFrameCallback"}`
	events := []telemetry.PlaybackEvent{
		{ID: "00000000-0000-4000-8000-000000000001", SequenceNumber: 0, EventType: "play_requested", WallTimeMS: 900, MonotonicMS: 10},
		{ID: "00000000-0000-4000-8000-000000000002", SequenceNumber: 1, EventType: "first_frame", WallTimeMS: 1_400, MonotonicMS: 510, PayloadJSON: &payload},
		{ID: "00000000-0000-4000-8000-000000000003", SequenceNumber: 2, EventType: "buffering_started", WallTimeMS: 1_800, MonotonicMS: 900},
		{ID: "00000000-0000-4000-8000-000000000004", SequenceNumber: 3, EventType: "buffering_ended", WallTimeMS: 2_100, MonotonicMS: 1_200},
	}
	inserted, err := database.InsertPlaybackEvents(sessionID, events)
	if err != nil {
		t.Fatal(err)
	}
	if inserted != 4 {
		t.Fatalf("inserted=%d", inserted)
	}
	duplicates, err := database.InsertPlaybackEvents(sessionID, events)
	if err != nil || duplicates != 0 {
		t.Fatalf("dedupe inserted=%d err=%v", duplicates, err)
	}
	timeline, err := database.PlaybackTimeline("ws-inspector", sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.Summary.RequestCount != 2 || timeline.Summary.StartupTimeMS == nil || *timeline.Summary.StartupTimeMS != 500 || timeline.Summary.RebufferCount != 1 || timeline.Summary.RebufferDurationMS != 300 {
		t.Fatalf("unexpected summary: %+v", timeline.Summary)
	}
	if timeline.Summary.DeadlineMissCount != 1 {
		t.Fatalf("deadline misses=%d, want 1", timeline.Summary.DeadlineMissCount)
	}
}

func TestInvalidAndUncorrelatedCMCDRemainsFailOpen(t *testing.T) {
	database := newWorkspaceDB(t)
	request := models.ProxyRequest{WorkspaceSlug: "ws-invalid", StreamID: "stream", Kind: models.KindMaster, TargetURL: "https://origin/master.m3u8", Status: 200,
		CMCD: &models.RequestCMCD{Version: 1, Valid: false, ValidationErrors: []cmcd.Issue{{Code: cmcd.IssueInvalidNumber, Key: "br"}}, RawValue: "br=nope"}}
	if err := database.InsertProxyRequest(request); err != nil {
		t.Fatal(err)
	}
	rows, err := database.ListProxyRequests("ws-invalid", models.ModeProxy, "stream", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Status != 200 || rows[0].CMCD == nil || rows[0].CMCD.Valid || len(rows[0].CMCD.ValidationErrors) != 1 {
		t.Fatalf("invalid CMCD not preserved: %+v", rows)
	}
	var sessions int
	if err := database.conn.QueryRow(`SELECT COUNT(*) FROM playback_sessions`).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 0 {
		t.Fatalf("uncorrelated request created %d sessions", sessions)
	}
	if _, err := database.DeleteProxyRequests("ws-invalid", models.ModeProxy, "stream"); err != nil {
		t.Fatal(err)
	}
	var cmcdRows int
	if err := database.conn.QueryRow(`SELECT COUNT(*) FROM request_cmcd`).Scan(&cmcdRows); err != nil {
		t.Fatal(err)
	}
	if cmcdRows != 0 {
		t.Fatalf("CMCD dependent rows survived request deletion: %d", cmcdRows)
	}
}

func TestSameStreamKeepsDifferentCMCDSessionsIsolated(t *testing.T) {
	database := newWorkspaceDB(t)
	for index, sid := range []string{"sid-one", "sid-two"} {
		request := models.ProxyRequest{WorkspaceSlug: "ws-isolation", StreamID: "same-stream", Kind: models.KindSegment, TargetURL: "https://origin/" + sid + ".ts", Status: 200, StartedAtMS: int64(1000 + index*1000), CompletedAtMS: int64(1100 + index*1000), DurationMS: 100,
			CMCD: &models.RequestCMCD{Version: 1, Valid: true, SessionID: &sid}}
		if err := database.InsertProxyRequest(request); err != nil {
			t.Fatal(err)
		}
	}
	sessions, err := database.ListPlaybackSessions("ws-isolation", "same-stream", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 {
		t.Fatalf("got %d sessions, want 2", len(sessions))
	}
	for _, session := range sessions {
		timeline, err := database.PlaybackTimeline("ws-isolation", string(session.ID))
		if err != nil {
			t.Fatal(err)
		}
		if timeline.Summary.RequestCount != 1 {
			t.Fatalf("session %s contains %d requests", session.CMCDSessionID, timeline.Summary.RequestCount)
		}
		for _, entry := range timeline.Entries {
			if entry.Request != nil && (entry.Request.CMCD == nil || entry.Request.CMCD.SessionID == nil || *entry.Request.CMCD.SessionID != session.CMCDSessionID) {
				t.Fatalf("cross-session request in %s: %+v", session.CMCDSessionID, entry.Request)
			}
		}
	}
}

func TestExplicitObserverSessionLinksLaterCMCDRequests(t *testing.T) {
	database := newWorkspaceDB(t)
	sid := "preview-session"
	session, err := database.CreatePlaybackSession(PlaybackSessionCreate{WorkspaceSlug: "ws-preview", StreamID: "od-preview", CMCDSessionID: sid, InitialPreset: "clean"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.InsertProxyRequest(models.ProxyRequest{WorkspaceSlug: "ws-preview", StreamID: "od-preview", Kind: models.KindMaster, TargetURL: "https://origin/master.m3u8", Status: 200, StartedAtMS: 1_000, CompletedAtMS: 1_100, DurationMS: 100, CMCD: &models.RequestCMCD{Version: 1, Valid: true, SessionID: &sid}}); err != nil {
		t.Fatal(err)
	}
	event := telemetry.PlaybackEvent{ID: "00000000-0000-4000-8000-000000000010", SequenceNumber: 0, EventType: "session_started", WallTimeMS: 900, MonotonicMS: 1}
	if _, err := database.InsertPlaybackEvents(string(session.ID), []telemetry.PlaybackEvent{event}); err != nil {
		t.Fatal(err)
	}
	timeline, err := database.PlaybackTimeline("ws-preview", string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Entries) != 2 || timeline.Summary.RequestCount != 1 || timeline.Summary.EventCount != 1 || !timeline.Session.ObserverConnected {
		t.Fatalf("explicit session did not unify telemetry: %+v", timeline)
	}
}
