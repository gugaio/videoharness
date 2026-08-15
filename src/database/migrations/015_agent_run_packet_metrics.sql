ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS packet_metrics JSONB;
