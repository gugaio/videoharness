ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS logical_key text;

CREATE UNIQUE INDEX IF NOT EXISTS artifacts_investigation_logical_key_idx
  ON artifacts (investigation_id, logical_key)
  WHERE logical_key IS NOT NULL;
