package store

import (
	"path/filepath"
	"testing"
	"time"

	"streammock/internal/db"
	"streammock/internal/models"
)

func newTestStore(t *testing.T) *MemoryStore {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := database.Migrate(); err != nil {
		t.Fatal(err)
	}
	return New(database)
}

func sampleStream(id string, persist bool) models.Stream {
	now := time.Now().UTC()
	return models.Stream{
		ID: id, OriginalURL: "https://origin.example/master.m3u8",
		ProxyPath: "/s/" + id + "/master.m3u8", ActivePreset: "clean",
		Mode: models.ModeProxy, CaptureStatus: models.CaptureReady,
		RequestedDurationSeconds: 60, CreatedAt: now, UpdatedAt: now,
	}
}

func TestEphemeralStreamsNeverTouchDatabaseAndSweepWhenIdle(t *testing.T) {
	s := newTestStore(t)

	if err := s.Add(sampleStream("od-ephemeral", false), false); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPreset("od-ephemeral", "subway_3g"); err != nil {
		t.Fatalf("preset on ephemeral stream should not require a db row: %v", err)
	}
	if got, _ := s.GetPreset("od-ephemeral"); got != "subway_3g" {
		t.Fatalf("preset = %q, want subway_3g", got)
	}

	removed := s.SweepEphemeral(time.Hour)
	if removed != 0 {
		t.Fatalf("fresh stream must not be swept yet, removed %d", removed)
	}

	time.Sleep(30 * time.Millisecond)
	if got := s.SweepEphemeral(20 * time.Millisecond); got != 1 {
		t.Fatalf("expected 1 stream swept, got %d", got)
	}
	if _, ok := s.Get("od-ephemeral"); ok {
		t.Fatal("swept stream should be gone from memory")
	}
}

func TestSweepKeepsPersistedStreamsEvenWhenIdle(t *testing.T) {
	s := newTestStore(t)
	if err := s.Add(sampleStream("owned-1", true), true); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if got := s.SweepEphemeral(10 * time.Millisecond); got != 0 {
		t.Fatalf("persisted streams must never be swept, got %d removals", got)
	}
	if _, ok := s.Get("owned-1"); !ok {
		t.Fatal("persisted stream missing after sweep")
	}
}

func TestGetBumpsAccessTime(t *testing.T) {
	s := newTestStore(t)
	if err := s.Add(sampleStream("od-hot", false), false); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if _, ok := s.Get("od-hot"); !ok {
		t.Fatal("stream should exist")
	}
	if got := s.SweepEphemeral(15 * time.Millisecond); got != 0 {
		t.Fatalf("recently accessed stream must survive sweep, removed %d", got)
	}
}
