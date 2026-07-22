CREATE TABLE IF NOT EXISTS investigations (
  id uuid PRIMARY KEY,
  source_url text NOT NULL,
  problem_description text,
  state text NOT NULL CHECK (
    state IN ('queued', 'validating', 'collecting', 'analyzing', 'synthesizing', 'completed', 'failed')
  ),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'investigation',
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
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

CREATE INDEX IF NOT EXISTS jobs_claim_idx
  ON jobs (status, locked_until, created_at)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS investigation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investigation_events_timeline_idx
  ON investigation_events (investigation_id, id);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_key text NOT NULL,
  content_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_investigation_idx
  ON artifacts (investigation_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL UNIQUE REFERENCES investigations(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL,
  share_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
