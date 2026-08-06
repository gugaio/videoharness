ALTER TABLE playback_runs
  ADD COLUMN IF NOT EXISTS network_profile jsonb NOT NULL DEFAULT '{"schemaVersion":1,"name":"baseline","stages":[{"afterVideoRequests":0,"bandwidthKbps":100000,"latencyMs":0}]}'::jsonb;
