-- Playback delivery is authenticated by self-contained HMAC tokens. Keeping a
-- token hash would create an unnecessary database dependency on every URL issue.
ALTER TABLE playback_runs DROP COLUMN IF EXISTS token_hash;
