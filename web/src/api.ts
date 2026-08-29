import { DEFAULT_PRESETS, type ProxyRequest, type Stream } from "./types";

async function request<T>(
  path: string,
  init?: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `request to ${path} failed (${res.status})`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export async function listStreams(token: string): Promise<Stream[]> {
  const data = await request<{ streams: Stream[] }>("/api/streams", {}, token);
  return data.streams;
}

export async function getStream(id: string): Promise<Stream> {
  const data = await request<{ stream: Stream }>(`/api/streams/${id}`);
  return data.stream;
}

export async function addStream(url: string, durationSeconds = 60, label = "", token?: string): Promise<Stream> {
  const data = await request<{ stream: Stream }>(
    "/api/streams",
    { method: "POST", body: JSON.stringify({ url, label, duration_seconds: durationSeconds, mode: "clone" }) },
    token,
  );
  return data.stream;
}

export async function setPreset(
  id: string,
  preset: string,
  token?: string,
): Promise<Stream> {
  const data = await request<{ stream: Stream }>(
    `/api/streams/${id}/preset`,
    { method: "POST", body: JSON.stringify({ preset }) },
    token,
  );
  return data.stream;
}

export async function deleteStream(id: string, token?: string): Promise<void> {
  await request<void>(`/api/streams/${id}`, { method: "DELETE" }, token);
}

export async function getWorkspace(token?: string): Promise<{ slug: string; playback_url: string }> {
  return request<{ slug: string; playback_url: string }>("/api/workspace", {}, token);
}

export async function getWorkspaceRequests(
  token: string,
  mode: "proxy" | "clone" = "proxy",
  streamId?: string,
  source?: string,
  preset?: string,
): Promise<{ requests: ProxyRequest[] }> {
  const params = new URLSearchParams({ mode });
  if (streamId) params.set("stream", streamId);
  if (source) params.set("source", source);
  if (preset) params.set("preset", preset);
  const query = `?${params.toString()}`;
  const data = await request<{ requests: ProxyRequest[] }>(
    `/api/workspace/requests${query}`,
    {},
    token,
  );
  return { requests: data.requests ?? [] };
}

export async function clearWorkspaceRequests(token: string, mode: "proxy" | "clone", streamId?: string, source?: string, preset?: string): Promise<void> {
  const params = new URLSearchParams({ mode });
  if (streamId) params.set("stream", streamId);
  if (source) params.set("source", source);
  if (preset) params.set("preset", preset);
  await request<void>(`/api/workspace/requests?${params.toString()}`, { method: "DELETE" }, token);
}

export function withPresets(stream: Omit<Stream, "presets">): Stream {
  return { ...stream, presets: DEFAULT_PRESETS };
}
