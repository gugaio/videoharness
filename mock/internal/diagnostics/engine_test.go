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

func TestSlowOriginBodyUsesOriginReadTime(t *testing.T) {
	body := int64(1200)
	relay := int64(80)
	point := telemetry.RequestPoint{RequestID: 8, DurationMS: 1300, OriginBodyMS: &body, RelayMS: &relay}
	findings := Analyze(telemetry.Timeline{Entries: []telemetry.TimelineEntry{{Kind: telemetry.TimelineEntryRequest, Request: &point}}})
	for _, finding := range findings {
		if finding.RuleID == "slow_origin_body" {
			if !strings.Contains(finding.Message, "leitura do restante do corpo na origem") || len(finding.Measurements) != 1 || finding.Measurements[0].Name != "origin_body_read" || finding.Measurements[0].Value != float64(body) {
				t.Fatalf("slow body attribution: %+v", finding)
			}
			return
		}
	}
	t.Fatal("slow origin body finding missing")
}

func TestAnalyzeAggregatesRepeatedRequestRules(t *testing.T) {
	br, mtp := int64(1800), int64(900)
	first := telemetry.RequestPoint{RequestID: 1, DurationMS: 300, BitrateThroughputRatio: func() *float64 { value := 2.0; return &value }(), CMCD: &telemetry.RequestCMCD{Valid: true, BitrateKbps: &br, MeasuredThroughputKbps: &mtp}}
	second := first
	second.RequestID = 2
	findings := Analyze(telemetry.Timeline{Entries: []telemetry.TimelineEntry{
		{Kind: telemetry.TimelineEntryRequest, Request: &first},
		{Kind: telemetry.TimelineEntryRequest, Request: &second},
	}})
	for _, finding := range findings {
		if finding.RuleID == "bitrate_above_throughput" {
			if finding.Occurrences != 2 || len(finding.Evidence) != 2 {
				t.Fatalf("repeated finding was not consolidated: %+v", finding)
			}
			return
		}
	}
	t.Fatal("aggregated bitrate finding missing")
}
