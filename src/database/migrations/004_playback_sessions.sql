CREATE TABLE IF NOT EXISTS playback_sessions (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'expired')),
  requested_duration_ms integer NOT NULL CHECK (requested_duration_ms BETWEEN 5000 AND 60000),
  engine text CHECK (engine IN ('hls.js', 'native-hls')),
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS playback_sessions_investigation_idx
  ON playback_sessions (investigation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_playback_review_idx
  ON jobs (status, created_at) WHERE kind = 'playback_synthesis' AND status IN ('pending', 'running');
