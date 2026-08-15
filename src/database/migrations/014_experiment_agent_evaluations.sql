ALTER TABLE hypotheses
  DROP CONSTRAINT IF EXISTS hypotheses_status_check;

ALTER TABLE hypotheses
  ADD CONSTRAINT hypotheses_status_check CHECK (
    status IN ('OPEN', 'PARTIALLY_SUPPORTED', 'SUPPORTED', 'WEAKENED', 'REJECTED', 'UNRESOLVED')
  );

ALTER TABLE experiment_evaluations
  ADD COLUMN IF NOT EXISTS analysis jsonb;

CREATE TABLE IF NOT EXISTS experiment_evaluation_jobs (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES experiment_iterations(id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX IF NOT EXISTS experiment_evaluation_jobs_active_idx
  ON experiment_evaluation_jobs (experiment_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS experiment_evaluation_jobs_claim_idx
  ON experiment_evaluation_jobs (status, locked_until, created_at)
  WHERE status IN ('pending', 'running');
