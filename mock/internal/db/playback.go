package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"streammock/internal/telemetry"
)

// PlaybackSessionCreate contains the server-owned fields for an explicit
// Observer session. Lazy CMCD-only sessions are created by InsertProxyRequest.
type PlaybackSessionCreate struct {
	WorkspaceSlug  string
	StreamID       string
	CMCDSessionID  string
	ContentID      *string
	InitialPreset  string
	UserAgent      string
	TokenHash      string
	TokenExpiresMS int64
	AllowedOrigin  string
}

func (d *DB) CreatePlaybackSession(input PlaybackSessionCreate) (telemetry.Session, error) {
	now := time.Now().UTC().UnixMilli()
	id := uuid.NewString()
	_, err := d.conn.Exec(`INSERT INTO playback_sessions
		(id, workspace_slug, stream_id, cmcd_sid, content_id, cmcd_version, user_agent, initial_preset, observer_connected, started_at_ms, last_seen_at_ms, created_at_ms, ingest_token_hash, ingest_expires_at_ms, allowed_origin)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(workspace_slug, stream_id, cmcd_sid) DO UPDATE SET
		  ingest_token_hash = excluded.ingest_token_hash,
		  ingest_expires_at_ms = excluded.ingest_expires_at_ms,
		  allowed_origin = excluded.allowed_origin`,
		id, input.WorkspaceSlug, input.StreamID, input.CMCDSessionID, input.ContentID, input.UserAgent, input.InitialPreset,
		now, now, now, input.TokenHash, input.TokenExpiresMS, input.AllowedOrigin)
	if err != nil {
		return telemetry.Session{}, fmt.Errorf("create playback session: %w", err)
	}
	return d.GetPlaybackSessionByCMCD(input.WorkspaceSlug, input.StreamID, input.CMCDSessionID)
}

func scanSession(scanner interface{ Scan(...any) error }) (telemetry.Session, error) {
	var session telemetry.Session
	var contentID, playerName, playerVersion, userAgent sql.NullString
	var endedAt sql.NullInt64
	var observer bool
	var version int
	if err := scanner.Scan(&session.ID, &session.WorkspaceSlug, &session.StreamID, &session.CMCDSessionID,
		&contentID, &version, &playerName, &playerVersion, &userAgent, &session.InitialPreset, &observer,
		&session.StartedAtMS, &session.LastSeenAtMS, &endedAt, &session.CreatedAtMS); err != nil {
		return telemetry.Session{}, err
	}
	session.CMCDVersion = uint8(version)
	session.ObserverConnected = observer
	session.ContentID = nullStringPtr(contentID)
	session.PlayerName = nullStringPtr(playerName)
	session.PlayerVersion = nullStringPtr(playerVersion)
	session.UserAgent = nullStringPtr(userAgent)
	if endedAt.Valid {
		value := telemetry.UnixMillis(endedAt.Int64)
		session.EndedAtMS = &value
	}
	return session, nil
}

const sessionColumns = `id, workspace_slug, stream_id, cmcd_sid, content_id, cmcd_version, player_name, player_version, user_agent, initial_preset, observer_connected, started_at_ms, last_seen_at_ms, ended_at_ms, created_at_ms`

func (d *DB) GetPlaybackSessionByCMCD(workspaceSlug, streamID, sid string) (telemetry.Session, error) {
	session, err := scanSession(d.conn.QueryRow(`SELECT `+sessionColumns+` FROM playback_sessions WHERE workspace_slug = ? AND stream_id = ? AND cmcd_sid = ?`, workspaceSlug, streamID, sid))
	if err != nil {
		return telemetry.Session{}, fmt.Errorf("get playback session by CMCD sid: %w", err)
	}
	return session, nil
}

func (d *DB) GetPlaybackSession(workspaceSlug, id string) (telemetry.Session, error) {
	session, err := scanSession(d.conn.QueryRow(`SELECT `+sessionColumns+` FROM playback_sessions WHERE workspace_slug = ? AND id = ?`, workspaceSlug, id))
	if err != nil {
		return telemetry.Session{}, fmt.Errorf("get playback session: %w", err)
	}
	return session, nil
}

func (d *DB) ListPlaybackSessions(workspaceSlug, streamID string, limit int) ([]telemetry.Session, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := d.conn.Query(`SELECT `+sessionColumns+` FROM playback_sessions WHERE workspace_slug = ? AND (? = '' OR stream_id = ?) ORDER BY last_seen_at_ms DESC, id DESC LIMIT ?`, workspaceSlug, streamID, streamID, limit)
	if err != nil {
		return nil, fmt.Errorf("list playback sessions: %w", err)
	}
	defer rows.Close()
	sessions := make([]telemetry.Session, 0)
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan playback session: %w", err)
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

// ResolveIngestSession validates the stored write-only token hash and returns
// the target session without ever persisting or logging the raw token.
func (d *DB) ResolveIngestSession(tokenHash string, nowMS int64) (telemetry.Session, string, error) {
	var allowedOrigin sql.NullString
	row := d.conn.QueryRow(`SELECT `+sessionColumns+`, allowed_origin FROM playback_sessions WHERE ingest_token_hash = ? AND ingest_expires_at_ms >= ?`, tokenHash, nowMS)
	var session telemetry.Session
	var contentID, playerName, playerVersion, userAgent sql.NullString
	var endedAt sql.NullInt64
	var observer bool
	var version int
	if err := row.Scan(&session.ID, &session.WorkspaceSlug, &session.StreamID, &session.CMCDSessionID,
		&contentID, &version, &playerName, &playerVersion, &userAgent, &session.InitialPreset, &observer,
		&session.StartedAtMS, &session.LastSeenAtMS, &endedAt, &session.CreatedAtMS, &allowedOrigin); err != nil {
		return telemetry.Session{}, "", err
	}
	session.CMCDVersion, session.ObserverConnected = uint8(version), observer
	session.ContentID, session.PlayerName = nullStringPtr(contentID), nullStringPtr(playerName)
	session.PlayerVersion, session.UserAgent = nullStringPtr(playerVersion), nullStringPtr(userAgent)
	if endedAt.Valid {
		value := telemetry.UnixMillis(endedAt.Int64)
		session.EndedAtMS = &value
	}
	return session, allowedOrigin.String, nil
}

func (d *DB) InsertPlaybackEvents(sessionID string, events []telemetry.PlaybackEvent) (int64, error) {
	if len(events) == 0 {
		return 0, nil
	}
	tx, err := d.conn.Begin()
	if err != nil {
		return 0, fmt.Errorf("insert playback events begin: %w", err)
	}
	defer tx.Rollback()
	receivedAt := time.Now().UTC().UnixMilli()
	var inserted int64
	var lastSeen int64
	var endedAt *int64
	for _, event := range events {
		result, err := tx.Exec(`INSERT INTO playback_events
			(id, session_id, sequence_number, event_type, wall_time_ms, monotonic_ms, media_time_ms, buffer_ahead_ms, bitrate_kbps, throughput_kbps, payload_json, received_at_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_id, id) DO NOTHING`, event.ID, sessionID, event.SequenceNumber, event.EventType,
			event.WallTimeMS, event.MonotonicMS, event.MediaTimeMS, event.BufferAheadMS, event.BitrateKbps, event.ThroughputKbps, event.PayloadJSON, receivedAt)
		if err != nil {
			return 0, fmt.Errorf("insert playback event: %w", err)
		}
		count, _ := result.RowsAffected()
		inserted += count
		if int64(event.WallTimeMS) > lastSeen {
			lastSeen = int64(event.WallTimeMS)
		}
		if event.EventType == "session_ended" {
			value := int64(event.WallTimeMS)
			endedAt = &value
		}
	}
	if lastSeen == 0 {
		lastSeen = receivedAt
	}
	if _, err := tx.Exec(`UPDATE playback_sessions SET observer_connected = 1, last_seen_at_ms = MAX(last_seen_at_ms, ?), ended_at_ms = COALESCE(?, ended_at_ms) WHERE id = ?`, lastSeen, endedAt, sessionID); err != nil {
		return 0, fmt.Errorf("update observer session: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM playback_events WHERE rowid IN (
		SELECT rowid FROM playback_events WHERE session_id = ? ORDER BY wall_time_ms DESC, sequence_number DESC LIMIT -1 OFFSET 5000
	)`, sessionID); err != nil {
		return 0, fmt.Errorf("trim playback events: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit playback events: %w", err)
	}
	return inserted, nil
}

func (d *DB) PlaybackTimeline(workspaceSlug, sessionID string) (telemetry.Timeline, error) {
	session, err := d.GetPlaybackSession(workspaceSlug, sessionID)
	if err != nil {
		return telemetry.Timeline{}, err
	}
	requests, err := d.sessionRequestPoints(sessionID)
	if err != nil {
		return telemetry.Timeline{}, err
	}
	events, err := d.sessionEvents(sessionID)
	if err != nil {
		return telemetry.Timeline{}, err
	}
	entries := make([]telemetry.TimelineEntry, 0, len(requests)+len(events))
	for i := range requests {
		request := requests[i]
		entries = append(entries, telemetry.TimelineEntry{Kind: telemetry.TimelineEntryRequest, AtMS: request.StartedAtMS, Request: &request})
	}
	for i := range events {
		event := events[i]
		entries = append(entries, telemetry.TimelineEntry{Kind: telemetry.TimelineEntryEvent, AtMS: event.WallTimeMS, Event: &event})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].AtMS != entries[j].AtMS {
			return entries[i].AtMS < entries[j].AtMS
		}
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind < entries[j].Kind
		}
		if entries[i].Request != nil && entries[j].Request != nil {
			return entries[i].Request.RequestID < entries[j].Request.RequestID
		}
		return entries[i].Event.SequenceNumber < entries[j].Event.SequenceNumber
	})
	timeline := telemetry.Timeline{Session: session, Entries: entries}
	timeline.Summary = summarizeTimeline(timeline)
	return timeline, nil
}

func (d *DB) sessionRequestPoints(sessionID string) ([]telemetry.RequestPoint, error) {
	rows, err := d.conn.Query(`SELECT p.id, COALESCE(p.started_at_ms, 0), COALESCE(p.completed_at_ms, 0), p.duration_ms, p.status, p.bytes, p.kind, p.target_url, p.active_preset,
		p.intervention, p.added_latency_ms, p.injected_status, p.upstream_status, p.transport_error, p.dns_ms, p.connect_ms, p.tls_ms, p.ttfb_ms, p.relay_ms, p.origin_body_ms, p.local_serve_ms, p.connection_reused,
		c.valid, c.validation_errors_json, c.sid, c.cid, c.ot, c.sf, c.st, c.br_kbps, c.tb_kbps, c.bl_ms, c.mtp_kbps, c.rtp_kbps, c.dl_ms, c.object_duration_ms, c.playback_rate, c.startup, c.buffer_starvation, c.raw_value, c.canonical_value
		FROM proxy_requests p JOIN request_cmcd c ON c.request_id = p.id WHERE c.session_id = ? ORDER BY p.started_at_ms, p.id`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("load session requests: %w", err)
	}
	defer rows.Close()
	points := make([]telemetry.RequestPoint, 0)
	for rows.Next() {
		var point telemetry.RequestPoint
		var intervention, transport sql.NullString
		var dns, connect, tls, ttfb, relay, originBody, local sql.NullInt64
		var reused sql.NullBool
		var cm telemetry.RequestCMCD
		var issueJSON string
		var sid, cid, ot, sf, st sql.NullString
		var br, tb, bl, mtp, rtp, dl, od sql.NullInt64
		var pr sql.NullFloat64
		var startup, starvation sql.NullBool
		if err := rows.Scan(&point.RequestID, &point.StartedAtMS, &point.CompletedAtMS, &point.DurationMS, &point.Status, &point.Bytes, &point.Kind, &point.TargetURL, &point.ActivePreset,
			&intervention, &point.AddedLatencyMS, &point.InjectedStatus, &point.UpstreamStatus, &transport, &dns, &connect, &tls, &ttfb, &relay, &originBody, &local, &reused,
			&cm.Valid, &issueJSON, &sid, &cid, &ot, &sf, &st, &br, &tb, &bl, &mtp, &rtp, &dl, &od, &pr, &startup, &starvation, &cm.RawValue, &cm.CanonicalValue); err != nil {
			return nil, fmt.Errorf("scan session request: %w", err)
		}
		point.Intervention, point.TransportError = nullNonEmptyStringPtr(intervention), nullNonEmptyStringPtr(transport)
		point.DNSMS, point.ConnectMS, point.TLSMS = nullInt64Ptr(dns), nullInt64Ptr(connect), nullInt64Ptr(tls)
		point.TTFBMS, point.RelayMS, point.OriginBodyMS, point.LocalServeMS = nullInt64Ptr(ttfb), nullInt64Ptr(relay), nullInt64Ptr(originBody), nullInt64Ptr(local)
		if reused.Valid {
			value := reused.Bool
			point.ConnectionReused = &value
		}
		cm.SessionID, cm.ContentID, cm.ObjectType = nullStringPtr(sid), nullStringPtr(cid), nullStringPtr(ot)
		cm.StreamingFormat, cm.StreamType = nullStringPtr(sf), nullStringPtr(st)
		cm.BitrateKbps, cm.TopBitrateKbps, cm.BufferLengthMS = nullInt64Ptr(br), nullInt64Ptr(tb), nullInt64Ptr(bl)
		cm.MeasuredThroughputKbps, cm.RequestedThroughputKbps = nullInt64Ptr(mtp), nullInt64Ptr(rtp)
		cm.DeadlineMS, cm.ObjectDurationMS = nullInt64Ptr(dl), nullInt64Ptr(od)
		if pr.Valid {
			value := pr.Float64
			cm.PlaybackRate = &value
		}
		if startup.Valid {
			value := startup.Bool
			cm.Startup = &value
		}
		if starvation.Valid {
			value := starvation.Bool
			cm.BufferStarvation = &value
		}
		var issues []struct {
			Code string `json:"code"`
		}
		_ = json.Unmarshal([]byte(issueJSON), &issues)
		for _, issue := range issues {
			cm.ValidationErrors = append(cm.ValidationErrors, issue.Code)
		}
		point.CMCD = &cm
		deriveRequestMetrics(&point)
		points = append(points, point)
	}
	return points, rows.Err()
}

func nullNonEmptyStringPtr(value sql.NullString) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	v := value.String
	return &v
}

func deriveRequestMetrics(point *telemetry.RequestPoint) {
	if point.DurationMS > 0 && point.Bytes > 0 {
		value := float64(point.Bytes*8) / float64(point.DurationMS)
		point.EffectiveDeliveryKbps = &value
	}
	if point.CMCD == nil {
		return
	}
	// HLS.js emits dl=0 while startup has no buffered media. Zero is an
	// explicit "no useful deadline yet" signal, not a deadline at t=0.
	if point.CMCD.DeadlineMS != nil && *point.CMCD.DeadlineMS > 0 && point.DurationMS > *point.CMCD.DeadlineMS {
		value := point.DurationMS - *point.CMCD.DeadlineMS
		point.DeadlineMissMS = &value
	}
	// Likewise, bl=0 is expected for the first object before the first append;
	// it cannot establish a buffer-exhaustion finding by itself.
	if point.CMCD.BufferLengthMS != nil && *point.CMCD.BufferLengthMS > 0 && point.DurationMS > *point.CMCD.BufferLengthMS {
		value := point.DurationMS - *point.CMCD.BufferLengthMS
		point.BufferRiskMS = &value
	}
	if point.CMCD.BitrateKbps != nil && point.CMCD.MeasuredThroughputKbps != nil && *point.CMCD.MeasuredThroughputKbps > 0 {
		value := float64(*point.CMCD.BitrateKbps) / float64(*point.CMCD.MeasuredThroughputKbps)
		point.BitrateThroughputRatio = &value
	}
}

func (d *DB) sessionEvents(sessionID string) ([]telemetry.PlaybackEvent, error) {
	rows, err := d.conn.Query(`SELECT id, sequence_number, event_type, wall_time_ms, monotonic_ms, media_time_ms, buffer_ahead_ms, bitrate_kbps, throughput_kbps, payload_json, received_at_ms FROM playback_events WHERE session_id = ? ORDER BY wall_time_ms, sequence_number, id`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("load playback events: %w", err)
	}
	defer rows.Close()
	events := make([]telemetry.PlaybackEvent, 0)
	for rows.Next() {
		var event telemetry.PlaybackEvent
		var media, buffer, bitrate, throughput sql.NullInt64
		var payload sql.NullString
		if err := rows.Scan(&event.ID, &event.SequenceNumber, &event.EventType, &event.WallTimeMS, &event.MonotonicMS, &media, &buffer, &bitrate, &throughput, &payload, &event.ReceivedAtMS); err != nil {
			return nil, fmt.Errorf("scan playback event: %w", err)
		}
		event.MediaTimeMS, event.BufferAheadMS = nullInt64Ptr(media), nullInt64Ptr(buffer)
		event.BitrateKbps, event.ThroughputKbps = nullInt64Ptr(bitrate), nullInt64Ptr(throughput)
		event.PayloadJSON = nullStringPtr(payload)
		events = append(events, event)
	}
	return events, rows.Err()
}

func summarizeTimeline(timeline telemetry.Timeline) telemetry.SessionSummary {
	summary := telemetry.SessionSummary{ObservedDurationMS: int64(timeline.Session.LastSeenAtMS - timeline.Session.StartedAtMS)}
	var bitrateTotal int64
	var bitrateCount int64
	var playRequested *int64
	var bufferingStarted *int64
	for _, entry := range timeline.Entries {
		if entry.Request != nil {
			r := entry.Request
			summary.RequestCount++
			summary.Bytes += r.Bytes
			if r.Status >= 400 || r.TransportError != nil {
				summary.ErrorCount++
			}
			if r.Intervention != nil {
				summary.InterventionCount++
			}
			if r.DeadlineMissMS != nil {
				summary.DeadlineMissCount++
			}
			if r.CMCD != nil {
				if r.CMCD.Startup != nil && *r.CMCD.Startup {
					summary.UrgentRequestCount++
				}
				if r.CMCD.BufferStarvation != nil && *r.CMCD.BufferStarvation {
					summary.StarvationCount++
				}
				if r.CMCD.BitrateKbps != nil {
					value := *r.CMCD.BitrateKbps
					bitrateTotal += value
					bitrateCount++
					if summary.MinimumBitrateKbps == nil || value < *summary.MinimumBitrateKbps {
						v := value
						summary.MinimumBitrateKbps = &v
					}
					if summary.MaximumBitrateKbps == nil || value > *summary.MaximumBitrateKbps {
						v := value
						summary.MaximumBitrateKbps = &v
					}
				}
			}
			continue
		}
		if entry.Event == nil {
			continue
		}
		event := entry.Event
		summary.EventCount++
		switch event.EventType {
		case "play_requested":
			value := int64(event.WallTimeMS)
			playRequested = &value
		case "first_frame":
			if playRequested != nil && int64(event.WallTimeMS) >= *playRequested && summary.StartupTimeMS == nil {
				value := int64(event.WallTimeMS) - *playRequested
				summary.StartupTimeMS = &value
				method := "requestVideoFrameCallback"
				if event.PayloadJSON != nil {
					var payload struct {
						Method string `json:"method"`
					}
					_ = json.Unmarshal([]byte(*event.PayloadJSON), &payload)
					if payload.Method != "" {
						method = payload.Method
					}
				}
				summary.StartupMethod = &method
			}
		case "buffering_started":
			value := int64(event.WallTimeMS)
			bufferingStarted = &value
		case "buffering_ended":
			if bufferingStarted != nil && int64(event.WallTimeMS) >= *bufferingStarted {
				summary.RebufferCount++
				summary.RebufferDurationMS += int64(event.WallTimeMS) - *bufferingStarted
				bufferingStarted = nil
			}
		case "fps_drop":
			var payload struct {
				Dropped int64 `json:"dropped_frames"`
			}
			if event.PayloadJSON != nil {
				_ = json.Unmarshal([]byte(*event.PayloadJSON), &payload)
			}
			summary.DroppedFrames += payload.Dropped
		}
	}
	if bitrateCount > 0 {
		value := float64(bitrateTotal) / float64(bitrateCount)
		summary.AverageBitrateKbps = &value
	}
	return summary
}

func (d *DB) PurgePlaybackTelemetry(requestTTL, sessionTTL time.Duration) error {
	now := time.Now().UTC()
	if _, err := d.PurgeProxyRequests(requestTTL); err != nil {
		return err
	}
	eventCutoff := now.Add(-requestTTL).UnixMilli()
	if _, err := d.conn.Exec(`DELETE FROM playback_events WHERE received_at_ms < ?`, eventCutoff); err != nil {
		return fmt.Errorf("purge playback events: %w", err)
	}
	sessionCutoff := now.Add(-sessionTTL).UnixMilli()
	if _, err := d.conn.Exec(`DELETE FROM playback_sessions WHERE last_seen_at_ms < ?`, sessionCutoff); err != nil {
		return fmt.Errorf("purge playback sessions: %w", err)
	}
	return nil
}

func IsNotFound(err error) bool { return errors.Is(err, sql.ErrNoRows) }
