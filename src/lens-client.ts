import { z } from "zod";

const ManifestSummarySchema = z.object({
  protocol: z.string(),
  kind: z.string(),
  is_live: z.boolean(),
  variant_count: z.number().int().nullable().optional(),
  segment_count: z.number().int().nullable().optional(),
  rendition_count: z.number().int().nullable().optional(),
});

const InspectionDetailSchema = z.object({
  inspection_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  protocol: z.string().nullable().optional(),
  manifest: ManifestSummarySchema.nullable().optional(),
  error_stage: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  segments_planned: z.number().int().nullable().optional(),
  segments_captured: z.number().int().nullable().optional(),
  segments_failed: z.number().int().nullable().optional(),
  snapshot_url: z.string().nullable().optional(),
});

const InspectionCreatedSchema = z.object({
  inspection_id: z.string(),
  status: z.string(),
  status_url: z.string(),
  view_url: z.string(),
  expires_at: z.string(),
});

export type LensInspectionCreated = z.infer<typeof InspectionCreatedSchema>;
export type LensInspectionDetail = z.infer<typeof InspectionDetailSchema>;

export class LensApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LensApiError";
  }
}

export type LensFetch = (url: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 120_000;

export class LensClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: LensFetch = fetch,
  ) {}

  async createInspection(url: string): Promise<LensInspectionCreated> {
    const response = await this.fetchJson(
      `${this.baseUrl}/api/v1/inspections`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      },
    );
    return InspectionCreatedSchema.parse(await response.json());
  }

  async getInspection(inspectionId: string): Promise<LensInspectionDetail> {
    const response = await this.fetchJson(
      `${this.baseUrl}/api/v1/inspections/${encodeURIComponent(inspectionId)}`,
    );
    return InspectionDetailSchema.parse(await response.json());
  }

  /** Snapshot completo: validado minimamente (objeto) e repassado cru. */
  async getSnapshot(inspectionId: string): Promise<unknown> {
    const response = await this.fetchJson(
      `${this.baseUrl}/api/v1/inspections/${encodeURIComponent(inspectionId)}/snapshot`,
    );
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
      throw new LensApiError(502, "snapshot da lens não é um objeto");
    }
    return body;
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new LensApiError(502, `lens inacessível: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LensApiError(response.status, `lens respondeu ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response;
  }
}
