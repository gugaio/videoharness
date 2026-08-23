package db

import (
	"database/sql"
	"fmt"
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
	id            TEXT PRIMARY KEY,
	original_url  TEXT NOT NULL,
	proxy_path    TEXT NOT NULL,
	active_preset TEXT NOT NULL DEFAULT 'clean',
	owner_id      TEXT,
	created_at    TEXT NOT NULL
);`
	if _, err := d.conn.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	// Backfill owner_id on databases created before streams were per-user.
	cols, err := d.conn.Query(`PRAGMA table_info(streams)`)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	defer cols.Close()
	hasOwner := false
	for cols.Next() {
		var (
			cid    int
			name   string
			ctype  string
			notNul int
			dflt   any
			pk     int
		)
		if err := cols.Scan(&cid, &name, &ctype, &notNul, &dflt, &pk); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
		if name == "owner_id" {
			hasOwner = true
		}
	}
	if !hasOwner {
		if _, err := d.conn.Exec(`ALTER TABLE streams ADD COLUMN owner_id TEXT`); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return nil
}

func (d *DB) InsertStream(st models.Stream) error {
	_, err := d.conn.Exec(
		`INSERT INTO streams (id, original_url, proxy_path, active_preset, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		st.ID,
		st.OriginalURL,
		st.ProxyPath,
		st.ActivePreset,
		st.OwnerID,
		st.CreatedAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("insert stream: %w", err)
	}
	return nil
}

func (d *DB) ListStreams() ([]models.Stream, error) {
	return d.queryStreams(`SELECT id, original_url, proxy_path, active_preset, owner_id, created_at FROM streams ORDER BY created_at ASC`)
}

func (d *DB) ListStreamsByOwner(ownerID string) ([]models.Stream, error) {
	rows, err := d.conn.Query(
		`SELECT id, original_url, proxy_path, active_preset, owner_id, created_at FROM streams WHERE owner_id = ? ORDER BY created_at ASC`,
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
		var createdAt string
		if err := rows.Scan(&st.ID, &st.OriginalURL, &st.ProxyPath, &st.ActivePreset, &st.OwnerID, &createdAt); err != nil {
			return nil, fmt.Errorf("scan stream: %w", err)
		}
		ts, err := time.Parse(time.RFC3339, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse created_at %q: %w", createdAt, err)
		}
		st.CreatedAt = ts
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate streams: %w", err)
	}
	return out, nil
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
