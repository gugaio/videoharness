package diagnostics

import (
	"reflect"
	"strings"
	"testing"

	"streammock/internal/telemetry"
)

func TestAnalyzeDistinguishesInjectedOriginAndRisk(t *testing.T) {
	br, mtp, dl := int64(1500), int64(800), int64(500)
	ttfb := int64(1200)
	injected := telemetry.RequestPoint{RequestID: 1, StartedAtMS: 1000, CompletedAtMS: 1800, DurationMS: 800, Status: 504, InjectedStatus: 504, UpstreamStatus: 0, CMCD: &telemetry.RequestCMCD{Valid: true, BitrateKbps: &br, MeasuredThroughputKbps: &mtp, DeadlineMS: &dl}}
	derive := int64(300)
	ratio := float64(br) / float64(mtp)
	injected.DeadlineMissMS = &derive
	injected.BitrateThroughputRatio = &ratio
	origin := telemetry.RequestPoint{RequestID: 2, StartedAtMS: 2000, CompletedAtMS: 3300, DurationMS: 1300, Status: 503, UpstreamStatus: 503, TTFBMS: &ttfb, CMCD: &telemetry.RequestCMCD{Valid: true}}
	event := telemetry.PlaybackEvent{ID: "event-rebuffer", SequenceNumber: 1, EventType: "buffering_started", WallTimeMS: 1900}
	timeline := telemetry.Timeline{Entries: []telemetry.TimelineEntry{
		{Kind: telemetry.TimelineEntryRequest, AtMS: 1000, Request: &injected},
		{Kind: telemetry.TimelineEntryEvent, AtMS: 1900, Event: &event},
		{Kind: telemetry.TimelineEntryRequest, AtMS: 2000, Request: &origin},
	}}
	first := Analyze(timeline)
	second := Analyze(timeline)
	if !reflect.DeepEqual(first, second) {
		t.Fatal("findings are not deterministic")
	}
	byRule := map[string]Finding{}
	for _, finding := range first {
		byRule[finding.RuleID] = finding
	}
	if finding := byRule["streammock_injected_error"]; finding.Confidence != ConfidenceHigh || !strings.Contains(finding.Message, "origem não foi responsável") {
		t.Fatalf("injected attribution: %+v", finding)
	}
	if finding := byRule["origin_http_error"]; finding.Confidence != ConfidenceHigh || !strings.Contains(finding.Message, "origem respondeu") {
		t.Fatalf("origin attribution: %+v", finding)
	}
	if finding := byRule["deadline_miss"]; finding.Confidence != ConfidenceHigh || !strings.Contains(finding.Message, "registrou rebuffer") {
		t.Fatalf("observer correlation: %+v", finding)
	}
	if _, ok := byRule["high_origin_ttfb"]; !ok {
		t.Fatal("high TTFB finding missing")
	}
}

func TestDeadlineWithoutObserverIsExplicitlyRisk(t *testing.T) {
	dl, miss := int64(400), int64(200)
	point := telemetry.RequestPoint{RequestID: 7, DurationMS: 600, DeadlineMissMS: &miss, CMCD: &telemetry.RequestCMCD{Valid: true, DeadlineMS: &dl}}
	findings := Analyze(telemetry.Timeline{Entries: []telemetry.TimelineEntry{{Kind: telemetry.TimelineEntryRequest, Request: &point}}})
	for _, finding := range findings {
		if finding.RuleID == "deadline_miss" {
			if finding.Confidence != ConfidenceMedium || !strings.Contains(finding.Message, "risco inferido") {
				t.Fatalf("deadline wording: %+v", finding)
			}
			return
		}
	}
	t.Fatal("deadline finding missing")
}
