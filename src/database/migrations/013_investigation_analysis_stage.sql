ALTER TABLE investigations
  DROP CONSTRAINT investigations_state_check;

ALTER TABLE investigations
  ADD CONSTRAINT investigations_state_check CHECK (
    state IN (
      'queued',
      'validating',
      'collecting',
      'evidence_ready',
      'analysis_queued',
      'analyzing',
      'synthesizing',
      'completed',
      'failed'
    )
  );
