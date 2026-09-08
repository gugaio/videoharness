import type { ManifestSummary, Snapshot } from "./snapshot";

export type { CaptureReport, ManifestSummary, Snapshot } from "./snapshot";

export type InspectionDetail = {
  inspection_id: string;
  status: string;
  created_at: string;
  expires_at: string;
  protocol?: string | null;
  manifest?: ManifestSummary | null;
  error_stage?: string | null;
  error_message?: string | null;
  segments_planned?: number | null;
  segments_captured?: number | null;
  segments_failed?: number | null;
  snapshot_url?: string | null;
};

export type InspectionCreated = {
  inspection_id: string;
  status: string;
  status_url: string;
  view_url: string;
  expires_at: string;
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

/** Registrado pelo AuthTokenBridge (modo Clerk); dev-mode não registra. */
export function setTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createInspection(url: string): Promise<InspectionCreated> {
  return request<InspectionCreated>("/api/v1/inspections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function getInspection(inspectionId: string): Promise<InspectionDetail> {
  return request<InspectionDetail>(`/api/v1/inspections/${encodeURIComponent(inspectionId)}`);
}

export function getSnapshot(inspectionId: string): Promise<Snapshot> {
  return request<Snapshot>(`/api/v1/inspections/${encodeURIComponent(inspectionId)}/snapshot`);
}
