import type {
  ControlLiveInput,
  CreateStreamInput,
  LiveMock,
  MockStream,
  MockWorkspace,
  ProxyPlayback,
  ProxyPlaybackInput,
  ProxyRequestFilters,
  WorkspaceRequests,
} from "../../domain/streams.js";
import type {
  CreatePlaybackSessionInput,
  CreatedPlaybackSession,
  Finding,
  PlaybackSessionFilters,
  PlaybackTimeline,
  SessionListItem,
} from "../../domain/playback.js";

/** Porta para a engine de streams; hoje atendida pelo adapter Stream Mock. */
export interface StreamMockEngine {
  listStreams(ownerId: string): Promise<MockStream[]>;
  getStream(ownerId: string, streamId: string): Promise<MockStream>;
  createStream(ownerId: string, input: CreateStreamInput): Promise<MockStream>;
  deleteStream(ownerId: string, streamId: string): Promise<void>;
  setPreset(ownerId: string, streamId: string, preset: string): Promise<MockStream>;
  getLive(ownerId: string, streamId: string): Promise<LiveMock>;
  controlLive(ownerId: string, streamId: string, input: ControlLiveInput): Promise<LiveMock>;
  getWorkspace(ownerId: string): Promise<MockWorkspace>;
  /** Proxy on-demand: monta a capability URL sem persistir stream no mock. */
  createProxyPlayback(ownerId: string, input: ProxyPlaybackInput): Promise<ProxyPlayback>;
  /** Board de requests do workspace (consumo do proxy/clone). */
  listWorkspaceRequests(ownerId: string, filters: ProxyRequestFilters): Promise<WorkspaceRequests>;
  clearWorkspaceRequests(ownerId: string, filters: ProxyRequestFilters): Promise<void>;
  /** Sessões de playback observado (CMCD + observer) para o Inspector. */
  createPlaybackSession(ownerId: string, input: CreatePlaybackSessionInput): Promise<CreatedPlaybackSession>;
  listPlaybackSessions(ownerId: string, filters: PlaybackSessionFilters): Promise<SessionListItem[]>;
  getPlaybackTimeline(
    ownerId: string,
    sessionId: string,
  ): Promise<{ timeline: PlaybackTimeline; findings: Finding[] }>;
}

export class StreamMockError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "StreamMockError";
  }
}

/** Stream que não existe (404 da engine) vira erro dedicado para a rota decidir. */
export class StreamNotFoundError extends Error {
  constructor(streamId: string) {
    super(`stream ${streamId} não encontrado`);
    this.name = "StreamNotFoundError";
  }
}
