export type ObserverEventType =
  | "session_started" | "session_ended" | "play_requested" | "first_frame" | "playing"
  | "buffering_started" | "buffering_ended" | "seek_started" | "seek_ended" | "paused" | "resumed"
  | "ended" | "media_error" | "visibility_changed" | "media_snapshot"
  | "manifest_loading" | "manifest_loaded" | "manifest_parsed"
  | "fragment_loading" | "fragment_loaded" | "fragment_parsed" | "fragment_buffered"
  | "buffer_appended" | "buffer_append_error" | "level_switching" | "level_switched"
  | "emergency_downswitch" | "fps_drop" | "stall_detected" | "stall_resolved" | "hls_error";

export interface ObserverEvent {
  id: string;
  sequence_number: number;
  event_type: ObserverEventType;
  wall_time_ms: number;
  monotonic_ms: number;
  media_time_ms?: number;
  buffer_ahead_ms?: number;
  bitrate_kbps?: number;
  throughput_kbps?: number;
  payload_json?: string;
}

export type EmitObserverEvent = (type: ObserverEventType, payload?: Record<string, unknown>, metrics?: Partial<Pick<ObserverEvent, "bitrate_kbps" | "throughput_kbps">>) => void;

export interface PlaybackAdapter {
  attach(emit: EmitObserverEvent): () => void;
}

export interface PlaybackObserver {
  playRequested(): void;
  flush(): Promise<void>;
  destroy(): void;
}
