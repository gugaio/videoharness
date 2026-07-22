ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_signature text;

CREATE UNIQUE INDEX IF NOT EXISTS investigations_idempotency_key_idx
  ON investigations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
