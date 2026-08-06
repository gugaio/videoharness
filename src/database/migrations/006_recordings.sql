CREATE TABLE IF NOT EXISTS recordings (
  id uuid PRIMARY KEY,
  source_url text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('hls', 'dash')),
  state text NOT NULL CHECK (state IN ('queued', 'validating', 'collecting', 'ready', 'failed')),
  requested_duration_seconds integer NOT NULL CHECK (requested_duration_seconds BETWEEN 30 AND 600),
  requested_start_seconds integer NOT NULL DEFAULT 0 CHECK (requested_start_seconds BETWEEN 0 AND 86400),
  idempotency_key text NOT NULL UNIQUE,
  request_signature text NOT NULL,
  coverage_seconds numeric,
  total_bytes bigint CHECK (total_bytes IS NULL OR total_bytes >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS recording_jobs (
  id uuid PRIMARY KEY,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  locked_by text,
  locked_until timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS recording_jobs_claim_idx
  ON recording_jobs (status, locked_until, created_at)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS recording_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recording_events_timeline_idx
  ON recording_events (recording_id, id);

CREATE TABLE IF NOT EXISTS recorded_resources (
  id uuid PRIMARY KEY,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  logical_path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('master', 'media-playlist', 'init-segment', 'video-segment', 'audio-segment', 'subtitle')),
  storage_key text NOT NULL,
  content_type text,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recording_id, logical_path)
);
