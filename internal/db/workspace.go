package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

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
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.conn.Exec(
		`INSERT INTO proxy_requests (workspace_slug, stream_id, stream_mode, kind, target_url, status, duration_ms, bytes, client_ip, active_preset, hit_count, first_seen_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		req.WorkspaceSlug, req.StreamID, req.StreamMode, req.Kind, req.TargetURL, req.Status, req.DurationMS, req.Bytes, req.ClientIP, req.ActivePreset, now, now,
	)
	if err != nil {
		return fmt.Errorf("insert proxy request: %w", err)
	}
	return nil
}

func scanProxyRequests(rows *sql.Rows) ([]models.ProxyRequest, error) {
	var out []models.ProxyRequest
	for rows.Next() {
		var req models.ProxyRequest
		var firstSeen, lastSeen string
		if err := rows.Scan(&req.WorkspaceSlug, &req.StreamID, &req.StreamMode, &req.Kind, &req.TargetURL, &req.Status, &req.DurationMS, &req.Bytes, &req.ClientIP, &req.ActivePreset, &req.HitCount, &firstSeen, &lastSeen); err != nil {
			return nil, fmt.Errorf("scan proxy request: %w", err)
		}
		var err error
		if req.FirstSeenAt, err = time.Parse(time.RFC3339, firstSeen); err != nil {
			return nil, fmt.Errorf("parse first_seen_at %q: %w", firstSeen, err)
		}
		if req.LastSeenAt, err = time.Parse(time.RFC3339, lastSeen); err != nil {
			return nil, fmt.Errorf("parse last_seen_at %q: %w", lastSeen, err)
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

// ListProxyRequests returns the most recent request rows for a workspace,
// newest first.
func (d *DB) ListProxyRequests(slug, mode, streamID string, limit int) ([]models.ProxyRequest, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := d.conn.Query(
		`SELECT workspace_slug, stream_id, stream_mode, kind, target_url, status, duration_ms, bytes, client_ip, active_preset, hit_count, first_seen_at, last_seen_at
		 FROM proxy_requests WHERE workspace_slug = ? AND stream_mode = ? AND (? = '' OR stream_id = ?) ORDER BY last_seen_at DESC, id DESC LIMIT ?`,
		slug, mode, streamID, streamID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list proxy requests: %w", err)
	}
	defer rows.Close()
	return scanProxyRequests(rows)
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
