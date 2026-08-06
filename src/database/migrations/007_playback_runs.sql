CREATE TABLE IF NOT EXISTS playback_runs (
  id uuid PRIMARY KEY,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('created', 'active', 'completed', 'expired', 'failed')),
  max_duration_seconds integer NOT NULL CHECK (max_duration_seconds BETWEEN 30 AND 900),
  created_at timestamptz NOT NULL DEFAULT now(),
  first_media_request_at timestamptz,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  error_code text,
  error_message text
);

CREATE INDEX IF NOT EXISTS playback_runs_recording_idx ON playback_runs (recording_id, created_at DESC);
