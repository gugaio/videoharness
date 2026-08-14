ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS clone_spec jsonb,
  ADD COLUMN IF NOT EXISTS clone_plan jsonb;

CREATE TABLE IF NOT EXISTS test_environments (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  platform text,
  platform_version text,
  manufacturer text,
  model text,
  firmware_version text,
  application_name text,
  application_version text,
  player_engine text,
  network_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  goal text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'DRAFT', 'PLANNED', 'BUILDING_CLONES', 'AWAITING_TESTS', 'EVALUATING',
    'FOLLOWUP_REQUIRED', 'CONCLUDED', 'FAILED', 'CANCELLED'
  )),
  created_by text NOT NULL,
  target_environment_id uuid REFERENCES test_environments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiments_investigation_idx
  ON experiments (investigation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hypotheses (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  statement text NOT NULL,
  rationale text NOT NULL,
  evidence_for jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_against jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('OPEN', 'SUPPORTED', 'WEAKENED', 'REJECTED', 'UNRESOLVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hypotheses_experiment_idx ON hypotheses (experiment_id, created_at);

CREATE TABLE IF NOT EXISTS experiment_iterations (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  iteration_number integer NOT NULL CHECK (iteration_number > 0),
  rationale text NOT NULL,
  clone_specs jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PLANNED', 'BUILDING_CLONES', 'AWAITING_TESTS', 'EVALUATING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, iteration_number)
);

CREATE TABLE IF NOT EXISTS experiment_clones (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES experiment_iterations(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE,
  short_label text NOT NULL,
  is_control boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK (state IN ('QUEUED', 'BUILDING', 'VERIFYING', 'READY', 'FAILED')),
  clone_spec jsonb NOT NULL,
  clone_spec_hash text NOT NULL,
  execution_plan jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (experiment_id, short_label)
);

CREATE INDEX IF NOT EXISTS experiment_clones_iteration_idx ON experiment_clones (iteration_id, created_at);

CREATE TABLE IF NOT EXISTS test_requests (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES experiment_iterations(id) ON DELETE CASCADE,
  clone_id uuid NOT NULL UNIQUE REFERENCES experiment_clones(id) ON DELETE CASCADE,
  short_label text NOT NULL,
  test_url text NOT NULL,
  instructions text NOT NULL,
  hypothesis_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  environment_id uuid REFERENCES test_environments(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, short_label)
);

-- The device-facing URL is stable for the experiment. Selecting a test request
-- changes this pointer; it never changes the URL configured on the device.
ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS active_test_request_id uuid REFERENCES test_requests(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS test_results (
  id uuid PRIMARY KEY,
  test_request_id uuid NOT NULL UNIQUE REFERENCES test_requests(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_TESTED')),
  failure_stage text CHECK (failure_stage IN (
    'LOAD_MANIFEST', 'STARTUP', 'VIDEO_DECODE', 'AUDIO_DECODE', 'DRM', 'STALL',
    'ABR_SWITCH', 'SEEK', 'AV_SYNC', 'SUBTITLES', 'UNKNOWN'
  )),
  error_code text,
  time_to_first_frame_ms integer CHECK (time_to_first_frame_ms IS NULL OR time_to_first_frame_ms >= 0),
  stall_observed boolean,
  audio_observed boolean,
  video_observed boolean,
  av_sync_issue boolean,
  seek_issue boolean,
  notes text,
  evidence_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reported_by text NOT NULL,
  reported_via text NOT NULL CHECK (reported_via IN ('USER', 'AGENT', 'DEVICE', 'TRUSTED_TEST')),
  test_environment_id uuid REFERENCES test_environments(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiment_evaluations (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES experiment_iterations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('CONCLUDED', 'MORE_TESTS_REQUIRED', 'INCONCLUSIVE')),
  confidence text NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  summary text NOT NULL,
  hypothesis_updates jsonb NOT NULL,
  evidence_bundle jsonb NOT NULL,
  proposed_next_plan jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiment_evaluations_experiment_idx
  ON experiment_evaluations (experiment_id, created_at DESC);
