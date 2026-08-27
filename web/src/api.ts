import { DEFAULT_PRESETS, type Stream } from "./types";

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

export function withPresets(stream: Omit<Stream, "presets">): Stream {
  return { ...stream, presets: DEFAULT_PRESETS };
}
