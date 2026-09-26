export type Investigation = {
  id: string;
  inspection_id: string;
  created_at: string;
  budget_bytes: number;
  reserved_bytes: number;
  consumed_bytes: number;
};

export type InvestigationCapture = {
  id: string;
  investigation_id: string;
  idempotency_key_hash: string;
  request_hash: string;
  status: string;
  requested_bytes: number;
  bytes_received: number | null;
  consumption_known: boolean;
  request: Record<string, unknown>;
  lens_status: Record<string, unknown> | null;
  evidence: unknown | null;
  created_at: string;
  updated_at: string;
};
