import type {
  CreateInspectionRequest,
  InspectionDetail,
  InspectionResponse,
  Snapshot,
} from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      // corpo não-JSON; mantém o status como mensagem
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

export function createInspection(
  payload: CreateInspectionRequest,
): Promise<InspectionResponse> {
  return request<InspectionResponse>('/api/v1/inspections', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getInspection(id: string): Promise<InspectionDetail> {
  return request<InspectionDetail>(`/api/v1/inspections/${id}`)
}

export function getSnapshot(id: string): Promise<Snapshot> {
  return request<Snapshot>(`/api/v1/inspections/${id}/snapshot`)
}
