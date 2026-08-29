package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"streammock/internal/models"
)

type DB struct {
	conn *sql.DB
}

func Open(path string) (*DB, error) {
	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", path)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1)

	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return &DB{conn: conn}, nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

func (d *DB) Migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS streams (
    id                         TEXT PRIMARY KEY,
    original_url               TEXT NOT NULL,
    proxy_path                 TEXT NOT NULL,
    active_preset              TEXT NOT NULL DEFAULT 'clean',
    owner_id                   TEXT,
    mode                       TEXT NOT NULL DEFAULT 'proxy',
    capture_status             TEXT NOT NULL DEFAULT 'ready',
    requested_duration_seconds REAL NOT NULL DEFAULT 60,
    duration_seconds           REAL,
    total_bytes                INTEGER,
    resource_count             INTEGER,
    storage_key                TEXT,
    error_code                 TEXT,
    error_message              TEXT,
    created_at                 TEXT NOT NULL,
    updated_at                 TEXT NOT NULL
);`
	if _, err := d.conn.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	for _, column := range []struct{ name, definition string }{
		{"owner_id", "TEXT"},
		{"label", "TEXT NOT NULL DEFAULT ''"},
		{"workspace_slug", "TEXT"},
		{"mode", "TEXT NOT NULL DEFAULT 'proxy'"},
		{"capture_status", "TEXT NOT NULL DEFAULT 'ready'"},
		{"requested_duration_seconds", "REAL NOT NULL DEFAULT 60"},
		{"duration_seconds", "REAL"},
		{"total_bytes", "INTEGER"},
		{"resource_count", "INTEGER"},
		{"storage_key", "TEXT"},
		{"error_code", "TEXT"},
		{"error_message", "TEXT"},
		{"updated_at", "TEXT"},
	} {
		if err := d.ensureColumn(column.name, column.definition); err != nil {
			return err
		}
	}
	if _, err := d.conn.Exec(`UPDATE streams SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''`); err != nil {
		return fmt.Errorf("migrate updated_at: %w", err)
	}
	if _, err := d.conn.Exec(`CREATE TABLE IF NOT EXISTS stream_resources (
        stream_id TEXT NOT NULL,
        logical_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY (stream_id, logical_path),
        FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE CASCADE
    )`); err != nil {
		return fmt.Errorf("migrate resources: %w", err)
	}
	if _, err := d.conn.Exec(`CREATE TABLE IF NOT EXISTS workspaces (
        slug       TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
    )`); err != nil {
		return fmt.Errorf("migrate workspaces: %w", err)
	}
	if err := d.migrateProxyRequests(); err != nil {
		return err
	}
	for _, column := range []struct{ name, definition string }{
		{"client_range", "TEXT NOT NULL DEFAULT ''"}, {"forwarded_range", "TEXT NOT NULL DEFAULT ''"}, {"upstream_status", "INTEGER NOT NULL DEFAULT 0"}, {"content_range", "TEXT NOT NULL DEFAULT ''"}, {"content_length", "INTEGER NOT NULL DEFAULT 0"}, {"range_result", "TEXT NOT NULL DEFAULT 'not_requested'"}, {"diagnostic", "TEXT NOT NULL DEFAULT ''"}, {"intervention", "TEXT NOT NULL DEFAULT ''"}, {"added_latency_ms", "INTEGER NOT NULL DEFAULT 0"}, {"injected_status", "INTEGER NOT NULL DEFAULT 0"},
		{"started_at_ms", "INTEGER"}, {"completed_at_ms", "INTEGER"}, {"user_agent", "TEXT NOT NULL DEFAULT ''"},
		{"dns_ms", "INTEGER"}, {"connect_ms", "INTEGER"}, {"tls_ms", "INTEGER"}, {"ttfb_ms", "INTEGER"}, {"relay_ms", "INTEGER"}, {"local_serve_ms", "INTEGER"},
		{"connection_reused", "INTEGER"}, {"transport_error", "TEXT NOT NULL DEFAULT ''"},
	} {
		if err := d.ensureProxyRequestColumn(column.name, column.definition); err != nil {
			return err
		}
	}
	if _, err := d.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_proxy_requests_ws ON proxy_requests(workspace_slug, last_seen_at DESC)`); err != nil {
		return fmt.Errorf("migrate proxy_requests index: %w", err)
	}
	if err := d.migratePlaybackInspector(); err != nil {
		return err
	}
	return nil
}

func (d *DB) migratePlaybackInspector() error {
	const schema = `
CREATE TABLE IF NOT EXISTS playback_sessions (
  id TEXT PRIMARY KEY,
  workspace_slug TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  cmcd_sid TEXT NOT NULL,
  content_id TEXT,
  cmcd_version INTEGER NOT NULL,
  player_name TEXT,
  player_version TEXT,
  user_agent TEXT,
  initial_preset TEXT NOT NULL,
  observer_connected INTEGER NOT NULL DEFAULT 0,
  started_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  ingest_token_hash TEXT,
  ingest_expires_at_ms INTEGER,
  allowed_origin TEXT,
  UNIQUE(workspace_slug, stream_id, cmcd_sid)
);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_workspace_recent
  ON playback_sessions(workspace_slug, last_seen_at_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_sessions_ingest_token
  ON playback_sessions(ingest_token_hash) WHERE ingest_token_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS request_cmcd (
  request_id INTEGER PRIMARY KEY,
  session_id TEXT,
  version INTEGER NOT NULL,
  valid INTEGER NOT NULL,
  sid TEXT,
  cid TEXT,
  ot TEXT,
  sf TEXT,
  st TEXT,
  br_kbps INTEGER,
  tb_kbps INTEGER,
  mtp_kbps INTEGER,
  rtp_kbps INTEGER,
  bl_ms INTEGER,
  dl_ms INTEGER,
  object_duration_ms INTEGER,
  playback_rate REAL,
  startup INTEGER,
  buffer_starvation INTEGER,
  next_object_request TEXT,
  next_range_request TEXT,
  raw_value TEXT,
  canonical_value TEXT,
  extra_json TEXT,
  validation_errors_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_request_cmcd_session ON request_cmcd(session_id, request_id);
CREATE TABLE IF NOT EXISTS playback_events (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  wall_time_ms INTEGER NOT NULL,
  monotonic_ms INTEGER NOT NULL,
  media_time_ms INTEGER,
  buffer_ahead_ms INTEGER,
  bitrate_kbps INTEGER,
  throughput_kbps INTEGER,
  payload_json TEXT,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS idx_playback_events_timeline
  ON playback_events(session_id, wall_time_ms, sequence_number);
CREATE TRIGGER IF NOT EXISTS delete_proxy_request_cmcd
AFTER DELETE ON proxy_requests
BEGIN
  DELETE FROM request_cmcd WHERE request_id = OLD.id;
END;`
	if _, err := d.conn.Exec(schema); err != nil {
		return fmt.Errorf("migrate playback inspector: %w", err)
	}
	return nil
}

const proxyRequestsSchema = `CREATE TABLE proxy_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_slug TEXT NOT NULL,
    stream_id      TEXT NOT NULL,
    stream_mode    TEXT NOT NULL DEFAULT 'proxy',
    kind           TEXT NOT NULL,
    target_url     TEXT NOT NULL,
    status         INTEGER NOT NULL,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    bytes          INTEGER NOT NULL DEFAULT 0,
    client_ip      TEXT NOT NULL DEFAULT '',
    active_preset   TEXT NOT NULL DEFAULT '',
    intervention    TEXT NOT NULL DEFAULT '',
    added_latency_ms INTEGER NOT NULL DEFAULT 0,
    injected_status INTEGER NOT NULL DEFAULT 0,
	started_at_ms INTEGER,
	completed_at_ms INTEGER,
	user_agent TEXT NOT NULL DEFAULT '',
	dns_ms INTEGER,
	connect_ms INTEGER,
	tls_ms INTEGER,
	ttfb_ms INTEGER,
	relay_ms INTEGER,
	local_serve_ms INTEGER,
	connection_reused INTEGER,
	transport_error TEXT NOT NULL DEFAULT '',
    hit_count      INTEGER NOT NULL DEFAULT 1,
    first_seen_at  TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL
)`

func (d *DB) migrateProxyRequests() error {
	var schema string
	err := d.conn.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'proxy_requests'`).Scan(&schema)
	if err == sql.ErrNoRows {
		if _, err := d.conn.Exec(proxyRequestsSchema); err != nil {
			return fmt.Errorf("migrate proxy_requests: %w", err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect proxy_requests: %w", err)
	}
	if !strings.Contains(schema, "UNIQUE(workspace_slug, stream_id, target_url)") {
		return nil
	}
	tx, err := d.conn.Begin()
	if err != nil {
		return fmt.Errorf("migrate proxy_requests begin: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(strings.Replace(proxyRequestsSchema, "proxy_requests", "proxy_requests_new", 1)); err != nil {
		return fmt.Errorf("create proxy request history: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO proxy_requests_new (id, workspace_slug, stream_id, stream_mode, kind, target_url, status, duration_ms, bytes, client_ip, active_preset, hit_count, first_seen_at, last_seen_at)
        SELECT id, workspace_slug, stream_id, 'proxy', kind, target_url, status, duration_ms, bytes, client_ip, active_preset, hit_count, first_seen_at, last_seen_at FROM proxy_requests`); err != nil {
		return fmt.Errorf("copy proxy request history: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE proxy_requests`); err != nil {
		return fmt.Errorf("replace proxy request history: %w", err)
	}
	if _, err := tx.Exec(`ALTER TABLE proxy_requests_new RENAME TO proxy_requests`); err != nil {
		return fmt.Errorf("rename proxy request history: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit proxy request history: %w", err)
	}
	return nil
}

func (d *DB) ensureColumn(name, definition string) error {
	rows, err := d.conn.Query(`PRAGMA table_info(streams)`)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var column, ctype string
		var defaultValue any
		if err := rows.Scan(&cid, &column, &ctype, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		if column == name {
			return nil
		}
	}
	if _, err := d.conn.Exec(`ALTER TABLE streams ADD COLUMN ` + name + ` ` + definition); err != nil {
		return fmt.Errorf("migrate add %s: %w", name, err)
	}
	return nil
}

func (d *DB) ensureProxyRequestColumn(name, definition string) error {
	rows, err := d.conn.Query(`PRAGMA table_info(proxy_requests)`)
	if err != nil {
		return fmt.Errorf("migrate proxy_requests: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var column, ctype string
		var defaultValue any
		if err := rows.Scan(&cid, &column, &ctype, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if column == name {
			return nil
		}
	}
	if _, err := d.conn.Exec(`ALTER TABLE proxy_requests ADD COLUMN ` + name + ` ` + definition); err != nil {
		return fmt.Errorf("migrate proxy_requests add %s: %w", name, err)
	}
	return nil
}

func (d *DB) InsertStream(st models.Stream) error {
	_, err := d.conn.Exec(
		`INSERT INTO streams (id, label, original_url, proxy_path, active_preset, owner_id, workspace_slug, mode, capture_status, requested_duration_seconds, duration_seconds, total_bytes, resource_count, storage_key, error_code, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		st.ID,
		st.Label,
		st.OriginalURL,
		st.ProxyPath,
		st.ActivePreset,
		st.OwnerID,
		st.WorkspaceSlug,
		st.Mode,
		st.CaptureStatus,
		st.RequestedDurationSeconds,
		st.DurationSeconds,
		st.TotalBytes,
		st.ResourceCount,
		st.StorageKey,
		st.ErrorCode,
		st.ErrorMessage,
		st.CreatedAt.UTC().Format(time.RFC3339),
		st.UpdatedAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("insert stream: %w", err)
	}
	return nil
}

func (d *DB) DeleteStream(id string) error {
	if _, err := d.conn.Exec(`DELETE FROM streams WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete stream: %w", err)
	}
	return nil
}

func (d *DB) ListStreams() ([]models.Stream, error) {
	return d.queryStreams(`SELECT id, label, original_url, proxy_path, active_preset, owner_id, workspace_slug, mode, capture_status, requested_duration_seconds, duration_seconds, total_bytes, resource_count, storage_key, error_code, error_message, created_at, updated_at FROM streams ORDER BY created_at ASC`)
}

func (d *DB) ListStreamsByOwner(ownerID string) ([]models.Stream, error) {
	rows, err := d.conn.Query(
		`SELECT id, label, original_url, proxy_path, active_preset, owner_id, workspace_slug, mode, capture_status, requested_duration_seconds, duration_seconds, total_bytes, resource_count, storage_key, error_code, error_message, created_at, updated_at FROM streams WHERE owner_id = ? ORDER BY created_at ASC`,
		ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("list streams by owner: %w", err)
	}
	defer rows.Close()
	return scanStreams(rows)
}

func (d *DB) queryStreams(query string) ([]models.Stream, error) {
	rows, err := d.conn.Query(query)
	if err != nil {
		return nil, fmt.Errorf("list streams: %w", err)
	}
	defer rows.Close()
	return scanStreams(rows)
}

func scanStreams(rows *sql.Rows) ([]models.Stream, error) {
	var out []models.Stream
	for rows.Next() {
		var st models.Stream
		var createdAt, updatedAt string
		if err := rows.Scan(&st.ID, &st.Label, &st.OriginalURL, &st.ProxyPath, &st.ActivePreset, &st.OwnerID, &st.WorkspaceSlug, &st.Mode, &st.CaptureStatus, &st.RequestedDurationSeconds, &st.DurationSeconds, &st.TotalBytes, &st.ResourceCount, &st.StorageKey, &st.ErrorCode, &st.ErrorMessage, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan stream: %w", err)
		}
		ts, err := time.Parse(time.RFC3339, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse created_at %q: %w", createdAt, err)
		}
		st.CreatedAt = ts
		st.UpdatedAt, err = time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse updated_at %q: %w", updatedAt, err)
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate streams: %w", err)
	}
	return out, nil
}

func (d *DB) UpdateCaptureStatus(id, status string) error {
	_, err := d.conn.Exec(`UPDATE streams SET capture_status = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?`, status, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

func (d *DB) CompleteClone(id string, duration float64, totalBytes int64, storageKey string, resources []models.Resource) error {
	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM stream_resources WHERE stream_id = ?`, id); err != nil {
		return err
	}
	for _, resource := range resources {
		if _, err := tx.Exec(`INSERT INTO stream_resources (stream_id, logical_path, kind, content_type, size_bytes, sha256) VALUES (?, ?, ?, ?, ?, ?)`, id, resource.LogicalPath, resource.Kind, resource.ContentType, resource.SizeBytes, resource.SHA256); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE streams SET capture_status = ?, duration_seconds = ?, total_bytes = ?, resource_count = ?, storage_key = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?`, models.CaptureReady, duration, totalBytes, len(resources), storageKey, time.Now().UTC().Format(time.RFC3339), id); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) FailClone(id, code, message string) error {
	_, err := d.conn.Exec(`UPDATE streams SET capture_status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`, models.CaptureFailed, code, message, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

func (d *DB) ListResources(streamID string) ([]models.Resource, error) {
	rows, err := d.conn.Query(`SELECT stream_id, logical_path, kind, content_type, size_bytes, sha256 FROM stream_resources WHERE stream_id = ?`, streamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Resource
	for rows.Next() {
		var resource models.Resource
		if err := rows.Scan(&resource.StreamID, &resource.LogicalPath, &resource.Kind, &resource.ContentType, &resource.SizeBytes, &resource.SHA256); err != nil {
			return nil, err
		}
		out = append(out, resource)
	}
	return out, rows.Err()
}

func (d *DB) UpdatePreset(id, preset string) error {
	res, err := d.conn.Exec(`UPDATE streams SET active_preset = ? WHERE id = ?`, preset, id)
	if err != nil {
		return fmt.Errorf("update preset: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update preset rows: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("stream %q not found", id)
	}
	return nil
}
