ALTER TABLE playback_runs ADD COLUMN IF NOT EXISTS fault_plan jsonb;

ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS fault_rule_id text;
ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS fault_action text;
