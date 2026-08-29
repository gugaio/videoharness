package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"streammock/internal/models"
)

// NewWorkspaceSlug generates an unguessable public identifier.
func NewWorkspaceSlug() (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate workspace slug: %w", err)
	}
	return "ws-" + hex.EncodeToString(buf), nil
}

// EnsureWorkspace returns the workspace slug owned by ownerID, creating the
// workspace on first access. Safe under concurrent first access.
func (d *DB) EnsureWorkspace(ownerID string) (string, error) {
	if slug, err := d.workspaceByOwner(ownerID); err == nil {
		return slug, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	for attempt := 0; attempt < 3; attempt++ {
		slug, err := NewWorkspaceSlug()
		if err != nil {
			return "", err
		}
		if _, err := d.conn.Exec(`INSERT INTO workspaces (slug, owner_id, created_at) VALUES (?, ?, ?)`, slug, ownerID, time.Now().UTC().Format(time.RFC3339)); err == nil {
			return slug, nil
		}
		// Either a slug collision or a concurrent create by the same owner.
		if found, lookupErr := d.workspaceByOwner(ownerID); lookupErr == nil {
			return found, nil
		} else if !errors.Is(lookupErr, sql.ErrNoRows) {
			return "", lookupErr
		}
	}
	return "", errors.New("could not allocate workspace slug")
}

func (d *DB) workspaceByOwner(ownerID string) (string, error) {
	var slug string
	err := d.conn.QueryRow(`SELECT slug FROM workspaces WHERE owner_id = ?`, ownerID).Scan(&slug)
	if err != nil {
		return "", err
	}
	return slug, nil
}

// WorkspaceOwner maps a public slug back to its owner. Unknown slugs yield
// ("", false) so unregistered slugs can be rejected before logging.
func (d *DB) WorkspaceOwner(slug string) (string, bool) {
	var owner string
	if err := d.conn.QueryRow(`SELECT owner_id FROM workspaces WHERE slug = ?`, slug).Scan(&owner); err != nil {
		return "", false
	}
	return owner, true
}

// InsertProxyRequest records each playback request as its own history row.
func (d *DB) InsertProxyRequest(req models.ProxyRequest) error {
	if req.StreamMode == "" {
		req.StreamMode = models.ModeProxy
	}
	nowMS := time.Now().UTC().UnixMilli()
	if req.CompletedAtMS == 0 {
		req.CompletedAtMS = nowMS
	}
	if req.StartedAtMS == 0 {
		req.StartedAtMS = req.CompletedAtMS - req.DurationMS
	}
	// Keep the legacy text timestamp at second precision so lexical ordering is
	// stable; the new completed_at_ms column carries timeline precision.
	seen := time.UnixMilli(req.CompletedAtMS).UTC().Format(time.RFC3339)
	tx, err := d.conn.Begin()
	if err != nil {
		return fmt.Errorf("insert proxy request begin: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.Exec(
		`INSERT INTO proxy_requests (workspace_slug, stream_id, stream_mode, kind, target_url, status, duration_ms, bytes, client_ip, active_preset, client_range, forwarded_range, upstream_status, content_range, content_length, range_result, diagnostic, intervention, added_latency_ms, injected_status, started_at_ms, completed_at_ms, user_agent, dns_ms, connect_ms, tls_ms, ttfb_ms, relay_ms, local_serve_ms, connection_reused, transport_error, hit_count, first_seen_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		req.WorkspaceSlug, req.StreamID, req.StreamMode, req.Kind, req.TargetURL, req.Status, req.DurationMS, req.Bytes, req.ClientIP, req.ActivePreset, req.ClientRange, req.ForwardedRange, req.UpstreamStatus, req.ContentRange, req.ContentLength, req.RangeResult, req.Diagnostic, req.Intervention, req.AddedLatencyMS, req.InjectedStatus,
		req.StartedAtMS, req.CompletedAtMS, req.UserAgent, req.DNSMS, req.ConnectMS, req.TLSMS, req.TTFBMS, req.RelayMS, req.LocalServeMS, req.ConnectionReused, req.TransportError, seen, seen,
	)
	if err != nil {
		return fmt.Errorf("insert proxy request: %w", err)
	}
	requestID, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("read proxy request id: %w", err)
	}
	if req.CMCD != nil {
		if err := insertRequestCMCD(tx, requestID, req); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit proxy request: %w", err)
	}
	return nil
}

func insertRequestCMCD(tx *sql.Tx, requestID int64, req models.ProxyRequest) error {
	data := req.CMCD
	extra, err := json.Marshal(data.Custom)
	if err != nil {
		return fmt.Errorf("encode CMCD custom values: %w", err)
	}
	issues, err := json.Marshal(data.ValidationErrors)
	if err != nil {
		return fmt.Errorf("encode CMCD validation errors: %w", err)
	}
	var sessionID *string
	if data.SessionID != nil && strings.TrimSpace(*data.SessionID) != "" {
		id := uuid.NewString()
		version := data.Version
		if version == 0 {
			version = 1
		}
		if _, err := tx.Exec(`INSERT INTO playback_sessions
			(id, workspace_slug, stream_id, cmcd_sid, content_id, cmcd_version, user_agent, initial_preset, observer_connected, started_at_ms, last_seen_at_ms, created_at_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
			ON CONFLICT(workspace_slug, stream_id, cmcd_sid) DO UPDATE SET
			  content_id = COALESCE(excluded.content_id, playback_sessions.content_id),
			  cmcd_version = excluded.cmcd_version,
			  user_agent = CASE WHEN excluded.user_agent <> '' THEN excluded.user_agent ELSE playback_sessions.user_agent END,
			  last_seen_at_ms = MAX(playback_sessions.last_seen_at_ms, excluded.last_seen_at_ms)`,
			id, req.WorkspaceSlug, req.StreamID, *data.SessionID, data.ContentID, version, req.UserAgent, req.ActivePreset, req.StartedAtMS, req.CompletedAtMS, req.StartedAtMS); err != nil {
			return fmt.Errorf("upsert playback session: %w", err)
		}
		var found string
		if err := tx.QueryRow(`SELECT id FROM playback_sessions WHERE workspace_slug = ? AND stream_id = ? AND cmcd_sid = ?`, req.WorkspaceSlug, req.StreamID, *data.SessionID).Scan(&found); err != nil {
			return fmt.Errorf("resolve playback session: %w", err)
		}
		sessionID = &found
	}
	valid := 0
	if data.Valid {
		valid = 1
	}
	if _, err := tx.Exec(`INSERT INTO request_cmcd
		(request_id, session_id, version, valid, sid, cid, ot, sf, st, br_kbps, tb_kbps, mtp_kbps, rtp_kbps, bl_ms, dl_ms, object_duration_ms, playback_rate, startup, buffer_starvation, next_object_request, next_range_request, raw_value, canonical_value, extra_json, validation_errors_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		requestID, sessionID, data.Version, valid, data.SessionID, data.ContentID, data.ObjectType, data.StreamingFormat, data.StreamType,
		data.BitrateKbps, data.TopBitrateKbps, data.MeasuredThroughputKbps, data.RequestedThroughputKbps, data.BufferLengthMS, data.DeadlineMS, data.ObjectDurationMS, data.PlaybackRate, data.Startup, data.BufferStarvation,
		data.NextObjectRequest, data.NextRangeRequest, data.RawValue, data.CanonicalValue, string(extra), string(issues)); err != nil {
		return fmt.Errorf("insert request CMCD: %w", err)
	}
	return nil
}

func scanProxyRequests(rows *sql.Rows) ([]models.ProxyRequest, error) {
	var out []models.ProxyRequest
	for rows.Next() {
		var req models.ProxyRequest
		var firstSeen, lastSeen string
		var startedAt, completedAt sql.NullInt64
		var dnsMS, connectMS, tlsMS, ttfbMS, relayMS, localMS sql.NullInt64
		var reused sql.NullBool
		if err := rows.Scan(&req.ID, &req.WorkspaceSlug, &req.StreamID, &req.StreamMode, &req.Kind, &req.TargetURL, &req.Status, &req.DurationMS, &req.Bytes, &req.ClientIP, &req.ActivePreset, &req.ClientRange, &req.ForwardedRange, &req.UpstreamStatus, &req.ContentRange, &req.ContentLength, &req.RangeResult, &req.Diagnostic, &req.Intervention, &req.AddedLatencyMS, &req.InjectedStatus, &startedAt, &completedAt, &req.UserAgent, &dnsMS, &connectMS, &tlsMS, &ttfbMS, &relayMS, &localMS, &reused, &req.TransportError, &req.HitCount, &firstSeen, &lastSeen); err != nil {
			return nil, fmt.Errorf("scan proxy request: %w", err)
		}
		req.StartedAtMS, req.CompletedAtMS = startedAt.Int64, completedAt.Int64
		req.DNSMS = nullInt64Ptr(dnsMS)
		req.ConnectMS = nullInt64Ptr(connectMS)
		req.TLSMS = nullInt64Ptr(tlsMS)
		req.TTFBMS = nullInt64Ptr(ttfbMS)
		req.RelayMS = nullInt64Ptr(relayMS)
		req.LocalServeMS = nullInt64Ptr(localMS)
		if reused.Valid {
			value := reused.Bool
			req.ConnectionReused = &value
		}
		var err error
		if req.FirstSeenAt, err = time.Parse(time.RFC3339, firstSeen); err != nil {
			return nil, fmt.Errorf("parse first_seen_at %q: %w", firstSeen, err)
		}
		if req.LastSeenAt, err = time.Parse(time.RFC3339, lastSeen); err != nil {
			return nil, fmt.Errorf("parse last_seen_at %q: %w", lastSeen, err)
		}
		if req.StartedAtMS == 0 {
			req.StartedAtMS = req.FirstSeenAt.UnixMilli() - req.DurationMS
		}
		if req.CompletedAtMS == 0 {
			req.CompletedAtMS = req.LastSeenAt.UnixMilli()
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

func nullInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	v := value.Int64
	return &v
}

// ListProxyRequests returns the most recent request rows for a workspace,
// newest first.
func (d *DB) ListProxyRequests(slug, mode, streamID string, limit int) ([]models.ProxyRequest, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := d.conn.Query(
		`SELECT id, workspace_slug, stream_id, stream_mode, kind, target_url, status, duration_ms, bytes, client_ip, active_preset, client_range, forwarded_range, upstream_status, content_range, content_length, range_result, diagnostic, intervention, added_latency_ms, injected_status, started_at_ms, completed_at_ms, user_agent, dns_ms, connect_ms, tls_ms, ttfb_ms, relay_ms, local_serve_ms, connection_reused, transport_error, hit_count, first_seen_at, last_seen_at
		 FROM proxy_requests WHERE workspace_slug = ? AND stream_mode = ? AND (? = '' OR stream_id = ?) ORDER BY last_seen_at DESC, id DESC LIMIT ?`,
		slug, mode, streamID, streamID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list proxy requests: %w", err)
	}
	requests, scanErr := scanProxyRequests(rows)
	closeErr := rows.Close()
	if scanErr != nil {
		return nil, scanErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := d.attachCMCD(requests); err != nil {
		return nil, err
	}
	return requests, nil
}

func (d *DB) attachCMCD(requests []models.ProxyRequest) error {
	if len(requests) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(requests)), ",")
	args := make([]any, len(requests))
	for i := range requests {
		args[i] = requests[i].ID
	}
	rows, err := d.conn.Query(`SELECT request_id, session_id, version, valid, sid, cid, ot, sf, st, br_kbps, tb_kbps, mtp_kbps, rtp_kbps, bl_ms, dl_ms, object_duration_ms, playback_rate, startup, buffer_starvation, next_object_request, next_range_request, raw_value, canonical_value, extra_json, validation_errors_json FROM request_cmcd WHERE request_id IN (`+placeholders+`)`, args...)
	if err != nil {
		return fmt.Errorf("load request CMCD: %w", err)
	}
	defer rows.Close()
	byID := make(map[int64]*models.RequestCMCD, len(requests))
	for rows.Next() {
		var requestID int64
		var data models.RequestCMCD
		var version int
		var valid bool
		var sessionID, sid, cid, ot, sf, st, nor, nrr sql.NullString
		var br, tb, mtp, rtp, bl, dl, od sql.NullInt64
		var pr sql.NullFloat64
		var startup, starvation sql.NullBool
		var raw, canonical, extra, issues string
		if err := rows.Scan(&requestID, &sessionID, &version, &valid, &sid, &cid, &ot, &sf, &st, &br, &tb, &mtp, &rtp, &bl, &dl, &od, &pr, &startup, &starvation, &nor, &nrr, &raw, &canonical, &extra, &issues); err != nil {
			return fmt.Errorf("scan request CMCD: %w", err)
		}
		data.Version, data.Valid = uint8(version), valid
		data.SessionInternalID = nullStringPtr(sessionID)
		data.SessionID, data.ContentID, data.ObjectType = nullStringPtr(sid), nullStringPtr(cid), nullStringPtr(ot)
		data.StreamingFormat, data.StreamType = nullStringPtr(sf), nullStringPtr(st)
		data.BitrateKbps, data.TopBitrateKbps = nullInt64Ptr(br), nullInt64Ptr(tb)
		data.MeasuredThroughputKbps, data.RequestedThroughputKbps = nullInt64Ptr(mtp), nullInt64Ptr(rtp)
		data.BufferLengthMS, data.DeadlineMS, data.ObjectDurationMS = nullInt64Ptr(bl), nullInt64Ptr(dl), nullInt64Ptr(od)
		if pr.Valid {
			v := pr.Float64
			data.PlaybackRate = &v
		}
		if startup.Valid {
			v := startup.Bool
			data.Startup = &v
		}
		if starvation.Valid {
			v := starvation.Bool
			data.BufferStarvation = &v
		}
		data.NextObjectRequest, data.NextRangeRequest = nullStringPtr(nor), nullStringPtr(nrr)
		data.RawValue, data.CanonicalValue = raw, canonical
		if extra != "" && extra != "null" {
			_ = json.Unmarshal([]byte(extra), &data.Custom)
		}
		if issues != "" {
			_ = json.Unmarshal([]byte(issues), &data.ValidationErrors)
		}
		byID[requestID] = &data
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("load request CMCD: %w", err)
	}
	for i := range requests {
		requests[i].CMCD = byID[requests[i].ID]
	}
	return nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	v := value.String
	return &v
}

func (d *DB) DeleteProxyRequests(slug, mode, streamID string) (int64, error) {
	res, err := d.conn.Exec(`DELETE FROM proxy_requests WHERE workspace_slug = ? AND stream_mode = ? AND stream_id = ?`, slug, mode, streamID)
	if err != nil {
		return 0, fmt.Errorf("delete proxy requests: %w", err)
	}
	return res.RowsAffected()
}

// CountProxyRequests returns the number of distinct logged resources seen for
// a workspace since the given time.
func (d *DB) CountProxyRequests(slug string, since time.Time) (int, error) {
	var count int
	err := d.conn.QueryRow(`SELECT COUNT(*) FROM proxy_requests WHERE workspace_slug = ? AND last_seen_at >= ?`, slug, since.UTC().Format(time.RFC3339)).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count proxy requests: %w", err)
	}
	return count, nil
}

// PurgeProxyRequests deletes rows whose last activity is older than ttl and
// returns how many rows were removed.
func (d *DB) PurgeProxyRequests(ttl time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-ttl).Format(time.RFC3339)
	res, err := d.conn.Exec(`DELETE FROM proxy_requests WHERE last_seen_at < ?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("purge proxy requests: %w", err)
	}
	return res.RowsAffected()
}

// TrimProxyRequests caps each workspace at keepPerWorkspace most recent rows,
// so long sessions cannot grow the table without bound.
func (d *DB) TrimProxyRequests(keepPerWorkspace int) (int64, error) {
	if keepPerWorkspace <= 0 {
		return 0, nil
	}
	res, err := d.conn.Exec(`DELETE FROM proxy_requests WHERE id IN (
		SELECT id FROM (
			SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_slug ORDER BY last_seen_at DESC, id DESC) AS rn
			FROM proxy_requests
		) WHERE rn > ?
	)`, keepPerWorkspace)
	if err != nil {
		return 0, fmt.Errorf("trim proxy requests: %w", err)
	}
	return res.RowsAffected()
}
