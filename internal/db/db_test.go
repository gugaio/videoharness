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
	stream := models.Stream{ID: "clone", OriginalURL: "https://origin.example/master.m3u8", ProxyPath: "/s/clone/master.m3u8", ActivePreset: "clean", Mode: models.ModeClone, CaptureStatus: models.CaptureQueued, RequestedDurationSeconds: 60, CreatedAt: now, UpdatedAt: now}
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
	if got := rows[0]; got.Mode != models.ModeClone || got.CaptureStatus != models.CaptureQueued || got.RequestedDurationSeconds != 60 {
		t.Fatalf("unexpected stream: %#v", got)
	}
}
