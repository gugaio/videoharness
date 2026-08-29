package diagnostics

import (
	"fmt"
	"strconv"

	"streammock/internal/telemetry"
)

// Analyze applies deterministic, versioned rules to a fully materialized
// timeline. It performs no I/O, which keeps exports and repeated reads stable.
func Analyze(timeline telemetry.Timeline) []Finding {
	findings := make([]Finding, 0)
	for _, entry := range timeline.Entries {
		if entry.Request == nil {
			continue
		}
		r := entry.Request
		evidence := []EvidenceReference{{Kind: EvidenceRequest, ID: strconv.FormatInt(r.RequestID, 10)}}
		rebuffer := followingEvent(timeline, int64(r.CompletedAtMS), 5000, "buffering_started")
		if r.InjectedStatus != 0 {
			message := fmt.Sprintf("StreamMock injetou HTTP %d; a origem não foi responsável por esta resposta.", r.InjectedStatus)
			confidence := ConfidenceHigh
			if rebuffer != nil {
				message += " O Observer registrou rebuffer logo depois."
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: rebuffer.ID})
			}
			findings = append(findings, Finding{RuleID: "streammock_injected_error", RuleVersion: 1, Severity: SeverityError, Confidence: confidence, Message: message, Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "injected_status", Value: float64(r.InjectedStatus), Unit: UnitCount}}})
		} else if r.TransportError != nil {
			findings = append(findings, Finding{RuleID: "origin_transport_error", RuleVersion: 1, Severity: SeverityError, Confidence: ConfidenceHigh, Message: "O transporte até a origem falhou sem uma resposta HTTP; nenhuma falha foi injetada pelo StreamMock.", Evidence: append([]EvidenceReference(nil), evidence...)})
		} else if r.UpstreamStatus >= 400 {
			findings = append(findings, Finding{RuleID: "origin_http_error", RuleVersion: 1, Severity: SeverityError, Confidence: ConfidenceHigh, Message: fmt.Sprintf("A origem respondeu HTTP %d e não houve status injetado pelo StreamMock.", r.UpstreamStatus), Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "origin_status", Value: float64(r.UpstreamStatus), Unit: UnitCount}}})
		}
		if r.AddedLatencyMS > 0 {
			confidence := ConfidenceHigh
			message := "O StreamMock adicionou latência artificial a este request; esse tempo não deve ser atribuído à origem."
			if rebuffer != nil {
				message += " O Observer registrou rebuffer logo depois."
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: rebuffer.ID})
			}
			findings = append(findings, Finding{RuleID: "streammock_added_latency", RuleVersion: 1, Severity: SeverityWarning, Confidence: confidence, Message: message, Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "added_latency", Value: float64(r.AddedLatencyMS), Unit: UnitMilliseconds}}})
		}
		if r.TTFBMS != nil && *r.TTFBMS >= 1000 && r.InjectedStatus == 0 {
			findings = append(findings, Finding{RuleID: "high_origin_ttfb", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceMedium, Message: "O tempo até o primeiro byte da origem foi alto; isto indica possível lentidão antes do relay do corpo.", Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "origin_ttfb", Value: float64(*r.TTFBMS), Unit: UnitMilliseconds}}})
		}
		if r.RelayMS != nil && *r.RelayMS >= 1000 && r.AddedLatencyMS == 0 {
			findings = append(findings, Finding{RuleID: "slow_origin_body", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceMedium, Message: "Os headers chegaram antes, mas o relay do corpo foi lento; isto sugere entrega progressiva lenta da origem.", Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "body_relay", Value: float64(*r.RelayMS), Unit: UnitMilliseconds}}})
		}
		if r.CMCD == nil {
			continue
		}
		if !r.CMCD.Valid {
			findings = append(findings, Finding{RuleID: "invalid_cmcd", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceHigh, Message: "O request foi servido normalmente, mas o CMCD recebido não está conforme e parte da telemetria pode estar ausente.", Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "validation_errors", Value: float64(len(r.CMCD.ValidationErrors)), Unit: UnitCount}}})
		}
		if r.BitrateThroughputRatio != nil && *r.BitrateThroughputRatio > 1 {
			severity := SeverityWarning
			if *r.BitrateThroughputRatio >= 1.2 {
				severity = SeverityError
			}
			confidence := ConfidenceMedium
			message := "O bitrate solicitado ficou acima do throughput estimado pelo player, criando risco de esgotar o buffer."
			if rebuffer != nil {
				confidence = ConfidenceHigh
				message = "O bitrate solicitado ficou acima do throughput estimado e o Observer registrou rebuffer logo depois."
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: rebuffer.ID})
			}
			findings = append(findings, Finding{RuleID: "bitrate_above_throughput", RuleVersion: 1, Severity: severity, Confidence: confidence, Message: message, Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "bitrate_to_throughput", Value: *r.BitrateThroughputRatio, Unit: UnitRatio}, {Name: "bitrate", Value: float64(*r.CMCD.BitrateKbps), Unit: UnitKbps}, {Name: "player_throughput", Value: float64(*r.CMCD.MeasuredThroughputKbps), Unit: UnitKbps}}})
		}
		if r.DeadlineMissMS != nil {
			confidence := ConfidenceMedium
			message := "O request terminou depois do deadline CMCD; isto é risco inferido, não confirmação de stall."
			if rebuffer != nil {
				confidence = ConfidenceHigh
				message = "O request terminou depois do deadline CMCD e o Observer registrou rebuffer logo depois."
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: rebuffer.ID})
			}
			findings = append(findings, Finding{RuleID: "deadline_miss", RuleVersion: 1, Severity: SeverityWarning, Confidence: confidence, Message: message, Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "deadline_miss", Value: float64(*r.DeadlineMissMS), Unit: UnitMilliseconds}, {Name: "request_total", Value: float64(r.DurationMS), Unit: UnitMilliseconds}}})
		}
		if r.BufferRiskMS != nil {
			confidence := ConfidenceLow
			message := "A duração do request excedeu o buffer informado pelo player; há risco inferido de esgotamento."
			if rebuffer != nil {
				confidence = ConfidenceHigh
				message = "A duração do request excedeu o buffer informado e foi seguida por rebuffer observado."
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: rebuffer.ID})
			}
			findings = append(findings, Finding{RuleID: "buffer_exhaustion_risk", RuleVersion: 1, Severity: SeverityWarning, Confidence: confidence, Message: message, Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "request_over_buffer", Value: float64(*r.BufferRiskMS), Unit: UnitMilliseconds}}})
		}
		if r.CMCD.BufferStarvation != nil && *r.CMCD.BufferStarvation {
			confidence := ConfidenceMedium
			message := "O próprio player marcou buffer starvation neste request."
			if rebuffer != nil {
				confidence = ConfidenceHigh
				message += " O Observer confirmou rebuffer posterior."
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: rebuffer.ID})
			}
			findings = append(findings, Finding{RuleID: "player_reported_starvation", RuleVersion: 1, Severity: SeverityWarning, Confidence: confidence, Message: message, Evidence: append([]EvidenceReference(nil), evidence...)})
		}
		if r.CMCD.Startup != nil && *r.CMCD.Startup {
			findings = append(findings, Finding{RuleID: "urgent_request", RuleVersion: 1, Severity: SeverityInfo, Confidence: ConfidenceLow, Message: "O player marcou o request como urgente; isoladamente isso pode representar startup, seek ou recuperação.", Evidence: append([]EvidenceReference(nil), evidence...)})
		}
		if r.CMCD.MeasuredThroughputKbps != nil && r.EffectiveDeliveryKbps != nil && *r.CMCD.MeasuredThroughputKbps > 0 {
			ratio := *r.EffectiveDeliveryKbps / float64(*r.CMCD.MeasuredThroughputKbps)
			if ratio > 2 || ratio < .5 {
				findings = append(findings, Finding{RuleID: "throughput_perception_divergence", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceMedium, Message: "A taxa efetiva observada pelo proxy divergiu materialmente da estimativa enviada pelo player.", Evidence: append([]EvidenceReference(nil), evidence...), Measurements: []Measurement{{Name: "proxy_to_player_throughput", Value: ratio, Unit: UnitRatio}, {Name: "effective_delivery", Value: *r.EffectiveDeliveryKbps, Unit: UnitKbps}, {Name: "player_throughput", Value: float64(*r.CMCD.MeasuredThroughputKbps), Unit: UnitKbps}}})
			}
		}
	}
	findings = append(findings, observerFindings(timeline)...)
	return findings
}

func observerFindings(timeline telemetry.Timeline) []Finding {
	findings := make([]Finding, 0)
	var playRequested, manifestLoaded, firstFragmentLoaded, firstFragmentBuffered, firstFrame *telemetry.PlaybackEvent
	var pendingFragment *telemetry.PlaybackEvent
	for _, entry := range timeline.Entries {
		if entry.Event == nil {
			continue
		}
		event := entry.Event
		switch event.EventType {
		case "play_requested":
			if playRequested == nil {
				playRequested = event
			}
		case "manifest_loaded":
			if manifestLoaded == nil {
				manifestLoaded = event
			}
		case "fragment_loaded":
			if firstFragmentLoaded == nil {
				firstFragmentLoaded = event
			}
			pendingFragment = event
		case "fragment_buffered":
			if firstFragmentBuffered == nil {
				firstFragmentBuffered = event
			}
			if pendingFragment != nil {
				delay := int64(event.WallTimeMS - pendingFragment.WallTimeMS)
				if delay >= 500 {
					findings = append(findings, Finding{RuleID: "slow_parse_or_append", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceHigh, Message: "O download terminou, mas parsing/append/bufferização demorou; o atraso foi observado no plano do player, não na rede.", Evidence: []EvidenceReference{{Kind: EvidenceEvent, ID: pendingFragment.ID}, {Kind: EvidenceEvent, ID: event.ID}}, Measurements: []Measurement{{Name: "download_to_buffered", Value: float64(delay), Unit: UnitMilliseconds}}})
				}
				pendingFragment = nil
			}
		case "first_frame":
			if firstFrame == nil {
				firstFrame = event
			}
		case "buffering_started", "stall_detected":
			if event.BufferAheadMS != nil && *event.BufferAheadMS >= 2000 {
				findings = append(findings, Finding{RuleID: "stall_with_high_buffer", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceHigh, Message: "O player parou apesar de ainda reportar buffer alto; gap, MSE ou decoder são mais prováveis que falta de rede.", Evidence: []EvidenceReference{{Kind: EvidenceEvent, ID: event.ID}}, Measurements: []Measurement{{Name: "buffer_ahead", Value: float64(*event.BufferAheadMS), Unit: UnitMilliseconds}}})
			}
		}
	}
	if playRequested != nil && firstFrame != nil {
		startup := int64(firstFrame.WallTimeMS - playRequested.WallTimeMS)
		if startup >= 2000 {
			measurements := []Measurement{{Name: "startup_total", Value: float64(startup), Unit: UnitMilliseconds}}
			evidence := []EvidenceReference{{Kind: EvidenceEvent, ID: playRequested.ID}, {Kind: EvidenceEvent, ID: firstFrame.ID}}
			if manifestLoaded != nil {
				measurements = append(measurements, Measurement{Name: "manifest_loaded_at", Value: float64(int64(manifestLoaded.WallTimeMS - playRequested.WallTimeMS)), Unit: UnitMilliseconds})
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: manifestLoaded.ID})
			}
			if firstFragmentLoaded != nil {
				measurements = append(measurements, Measurement{Name: "first_fragment_loaded_at", Value: float64(int64(firstFragmentLoaded.WallTimeMS - playRequested.WallTimeMS)), Unit: UnitMilliseconds})
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: firstFragmentLoaded.ID})
			}
			if firstFragmentBuffered != nil {
				measurements = append(measurements, Measurement{Name: "first_fragment_buffered_at", Value: float64(int64(firstFragmentBuffered.WallTimeMS - playRequested.WallTimeMS)), Unit: UnitMilliseconds})
				evidence = append(evidence, EvidenceReference{Kind: EvidenceEvent, ID: firstFragmentBuffered.ID})
			}
			findings = append(findings, Finding{RuleID: "slow_startup_breakdown", RuleVersion: 1, Severity: SeverityWarning, Confidence: ConfidenceHigh, Message: "O Observer confirmou startup lento e decompôs manifest, primeiro fragmento, append e primeiro frame quando disponíveis.", Evidence: evidence, Measurements: measurements})
		}
	}
	return findings
}

func followingEvent(timeline telemetry.Timeline, afterMS, windowMS int64, eventType string) *telemetry.PlaybackEvent {
	for _, entry := range timeline.Entries {
		if entry.Event == nil || entry.Event.EventType != eventType {
			continue
		}
		delta := int64(entry.Event.WallTimeMS) - afterMS
		if delta >= 0 && delta <= windowMS {
			return entry.Event
		}
	}
	return nil
}
