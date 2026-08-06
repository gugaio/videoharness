CREATE TABLE IF NOT EXISTS delivery_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  playback_run_id uuid NOT NULL REFERENCES playback_runs(id) ON DELETE CASCADE,
  logical_path text NOT NULL,
  resource_kind text NOT NULL,
  target_id text,
  media_sequence integer,
  stage_index integer NOT NULL,
  bandwidth_kbps integer NOT NULL,
  latency_ms integer NOT NULL,
  bytes_sent bigint NOT NULL CHECK (bytes_sent >= 0),
  status_code integer NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_requests_run_timeline_idx ON delivery_requests (playback_run_id, id DESC);
