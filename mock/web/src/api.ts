import { DEFAULT_PRESETS, type CreatedPlaybackSession, type Finding, type LiveMock, type PlaybackTimeline, type ProxyRequest, type SessionListItem, type Stream } from "./types";

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

export async function addStream(url: string, durationSeconds = 60, label = "", token?: string, format?: "hls" | "dash", protectionMode: "clear" | "clearkey" = "clear", trackSelection: "highest" | "all" = "highest"): Promise<Stream> {
  const data = await request<{ stream: Stream }>(
    "/api/streams",
    { method: "POST", body: JSON.stringify({ url, label, duration_seconds: durationSeconds, mode: "clone", format, protection_mode: protectionMode, track_selection: trackSelection }) },
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

export async function getLiveMock(id: string, token?: string): Promise<LiveMock> {
	const data = await request<{ live: LiveMock }>(`/api/streams/${id}/live`, {}, token);
	return data.live;
}

export async function controlLiveMock(id: string, action: "start" | "pause" | "resume" | "restart" | "stop", token?: string, options: { window_segments?: number; loop?: boolean } = {}): Promise<LiveMock> {
	const data = await request<{ live: LiveMock }>(
		`/api/streams/${id}/live`,
		{ method: "POST", body: JSON.stringify({ action, ...options }) },
		token,
	);
	return data.live;
}

export async function getWorkspace(token?: string): Promise<{ slug: string; playback_url: string; stored_bytes: number; quota_bytes: number; clone_ttl_hours: number }> {
  return request<{ slug: string; playback_url: string; stored_bytes: number; quota_bytes: number; clone_ttl_hours: number }>("/api/workspace", {}, token);
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

export async function createPlaybackSession(token: string, input: { source?: string; stream_id?: string; preset?: string; format?: "hls" | "dash"; content_id?: string; duration_seconds?: number; allowed_origin?: string; live?: boolean }): Promise<CreatedPlaybackSession> {
	return request<CreatedPlaybackSession>("/api/playback/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, token);
}

export async function listPlaybackSessions(token: string, filters: { stream?: string; source?: string; preset?: string } = {}): Promise<SessionListItem[]> {
	const params = new URLSearchParams();
	if (filters.stream) params.set("stream", filters.stream);
	if (filters.source) params.set("source", filters.source);
	if (filters.preset) params.set("preset", filters.preset);
	const data = await request<{ sessions: SessionListItem[] }>(`/api/playback/sessions?${params.toString()}`, {}, token);
	return data.sessions ?? [];
}

export async function getPlaybackTimeline(token: string, id: string): Promise<{ timeline: PlaybackTimeline; findings: Finding[] }> {
	return request<{ timeline: PlaybackTimeline; findings: Finding[] }>(`/api/playback/sessions/${id}/timeline`, {}, token);
}

export async function exportPlaybackSession(token: string, id: string): Promise<void> {
	const response = await fetch(`/api/playback/sessions/${id}/export`, { headers: { Authorization: `Bearer ${token}` } });
	if (!response.ok) throw new Error(await response.text() || "Export failed");
	const blob = await response.blob();
	const href = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = href; link.download = `streammock-playback-${id}.json`; link.click();
	URL.revokeObjectURL(href);
}
