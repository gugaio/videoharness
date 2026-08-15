CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, revision)
);

CREATE INDEX IF NOT EXISTS evidence_snapshots_current_idx
  ON evidence_snapshots (investigation_id, revision DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  evidence_snapshot_id uuid NOT NULL REFERENCES evidence_snapshots(id) ON DELETE RESTRICT,
  agent_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN ('completed', 'failed')),
  provider text NOT NULL,
  model text NOT NULL,
  system_prompt text NOT NULL,
  prompt text NOT NULL,
  tool_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, evidence_snapshot_id, agent_id, attempt)
);

CREATE INDEX IF NOT EXISTS agent_runs_investigation_idx
  ON agent_runs (investigation_id, created_at, agent_id, attempt);
