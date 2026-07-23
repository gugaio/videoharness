CREATE TABLE IF NOT EXISTS investigation_shell_runs (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  command text NOT NULL,
  exit_code integer,
  timed_out boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  output_truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investigation_shell_runs_investigation_idx
  ON investigation_shell_runs (investigation_id, created_at);
