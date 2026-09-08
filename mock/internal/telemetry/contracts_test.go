package telemetry

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTimelineContractOmitsUnknownMetrics(t *testing.T) {
	timeline := Timeline{
		Session: Session{ID: "session-internal", WorkspaceSlug: "ws-a", StreamID: "od-a", CMCDSessionID: "cmcd-a", CMCDVersion: 1, InitialPreset: "clean", StartedAtMS: 1000, LastSeenAtMS: 2000, CreatedAtMS: 1000},
		Summary: SessionSummary{ObservedDurationMS: 1000},
		Entries: []TimelineEntry{{Kind: TimelineEntryRequest, AtMS: 1000, Request: &RequestPoint{RequestID: 12, StartedAtMS: 1000, CompletedAtMS: 1200, DurationMS: 200, Status: 200, Kind: "segment", TargetURL: "https://origin/0.ts", ActivePreset: "clean", CMCD: &RequestCMCD{Valid: true}}}},
	}
	data, err := json.Marshal(timeline)
	if err != nil {
		t.Fatal(err)
	}
	encoded := string(data)
	for _, forbidden := range []string{"br_kbps", "bl_ms", "media_time_ms", "content_id"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("unknown field %q must be absent from %s", forbidden, encoded)
		}
	}
	if !strings.Contains(encoded, `"started_at_ms":1000`) || !strings.Contains(encoded, `"request_id":12`) {
		t.Fatalf("timeline contract lost required fields: %s", encoded)
	}
}
