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

export async function addStream(url: string, durationSeconds = 60, mode: "proxy" | "clone" = "clone", token?: string): Promise<Stream> {
  const data = await request<{ stream: Stream }>(
    "/api/streams",
    { method: "POST", body: JSON.stringify({ url, duration_seconds: durationSeconds, mode }) },
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

export async function getWorkspace(token?: string): Promise<{ slug: string; playback_url: string }> {
  return request<{ slug: string; playback_url: string }>("/api/workspace", {}, token);
}

export async function getWorkspaceRequests(
  token: string,
  workspace?: string,
): Promise<{ requests: ProxyRequest[]; total_24h: number }> {
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  const data = await request<{ requests: ProxyRequest[]; total_24h: number }>(
    `/api/workspace/requests${query}`,
    {},
    token,
  );
  return { requests: data.requests ?? [], total_24h: data.total_24h ?? 0 };
}

export function withPresets(stream: Omit<Stream, "presets">): Stream {
  return { ...stream, presets: DEFAULT_PRESETS };
}
