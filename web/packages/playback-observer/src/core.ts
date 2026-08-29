import { HTTPBatchTransport } from "./transport";
import type { EmitObserverEvent, PlaybackAdapter, PlaybackObserver, Transport } from "./types";

export const DEFAULT_OBSERVER_NAME = "@streammock/playback-observer";

export interface ObservePlaybackOptions {
  media: HTMLMediaElement;
  adapter?: PlaybackAdapter;
  sessionId?: string;
  ingestUrl?: string;
  transport?: Transport;
  context?: Record<string, unknown>;
  observerName?: string;
}

function bufferAheadMS(media: HTMLMediaElement): number {
  const position = media.currentTime;
  for (let index = 0; index < media.buffered.length; index += 1) {
    if (media.buffered.start(index) <= position && position <= media.buffered.end(index)) {
      return Math.max(0, Math.round((media.buffered.end(index) - position) * 1000));
    }
  }
  return 0;
}

export function observePlayback(options: ObservePlaybackOptions): PlaybackObserver {
  const { media, adapter, ingestUrl, sessionId } = options;
  const transport = options.transport ?? (ingestUrl ? new HTTPBatchTransport(ingestUrl) : undefined);
  if (!transport) throw new Error("observePlayback requires either ingestUrl or a custom transport");
  const context = { session_id: sessionId, ...options.context };
  const observerName = options.observerName ?? DEFAULT_OBSERVER_NAME;
  const removers: Array<() => void> = [];
  let sequence = 0;
  let destroyed = false;
  let playbackStarted = false;
  let seeking = false;
  let intentionalPause = media.paused;
  let buffering = false;
  let bufferingTimer: number | null = null;
  let firstFramePending = false;

  const emit: EmitObserverEvent = (eventType, payload, metrics) => {
    if (destroyed) return;
    transport.enqueue({
      id: crypto.randomUUID(), sequence_number: sequence++, event_type: eventType,
      wall_time_ms: Date.now(), monotonic_ms: Math.max(0, Math.round(performance.now())),
      media_time_ms: Number.isFinite(media.currentTime) ? Math.round(media.currentTime * 1000) : undefined,
      buffer_ahead_ms: bufferAheadMS(media),
      bitrate_kbps: metrics?.bitrate_kbps, throughput_kbps: metrics?.throughput_kbps,
      payload_json: payload ? JSON.stringify({ ...context, ...payload }) : undefined,
    });
  };

  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };

  const endBuffering = () => {
    if (bufferingTimer !== null) { window.clearTimeout(bufferingTimer); bufferingTimer = null; }
    if (buffering) { buffering = false; emit("buffering_ended"); }
  };

  const maybeBuffering = () => {
    if (!playbackStarted || intentionalPause || seeking || media.ended || buffering || bufferingTimer !== null) return;
    const previousTime = media.currentTime;
    bufferingTimer = window.setTimeout(() => {
      bufferingTimer = null;
      if (!destroyed && !media.paused && !seeking && !media.ended && Math.abs(media.currentTime - previousTime) < 0.05 && bufferAheadMS(media) <= 500) {
        buffering = true;
        emit("buffering_started", { evidence: "playhead_not_advancing_with_low_buffer" });
      }
    }, 250);
  };

  const firstFrame = (method: string) => {
    if (!firstFramePending) return;
    firstFramePending = false;
    playbackStarted = true;
    emit("first_frame", { method });
  };

  const playRequested = () => {
    intentionalPause = false;
    firstFramePending = !playbackStarted;
    emit("play_requested");
    const frameMedia = media as HTMLMediaElement & { requestVideoFrameCallback?: (callback: () => void) => number };
    if (firstFramePending && typeof frameMedia.requestVideoFrameCallback === "function") {
      frameMedia.requestVideoFrameCallback(() => firstFrame("requestVideoFrameCallback"));
    }
  };

  listen(media, "playing", () => { intentionalPause = false; endBuffering(); emit("playing"); firstFrame("playing_fallback"); });
  listen(media, "waiting", maybeBuffering);
  listen(media, "stalled", maybeBuffering);
  listen(media, "seeking", () => { seeking = true; endBuffering(); emit("seek_started"); });
  listen(media, "seeked", () => { seeking = false; emit("seek_ended"); });
  listen(media, "pause", () => { if (!media.ended) { intentionalPause = true; endBuffering(); emit("paused"); } });
  listen(media, "play", () => { if (intentionalPause) emit("resumed"); intentionalPause = false; });
  listen(media, "timeupdate", endBuffering);
  listen(media, "ended", () => { endBuffering(); emit("ended"); });
  listen(media, "error", () => emit("media_error", { code: media.error?.code, message: media.error?.message }));
  listen(document, "visibilitychange", () => emit("visibility_changed", { visibility_state: document.visibilityState }));
  listen(window, "pagehide", () => transport.closeWithBeacon());

  const snapshotTimer = window.setInterval(() => emit("media_snapshot", {
    paused: media.paused, seeking: media.seeking, ended: media.ended, ready_state: media.readyState,
    playback_rate: media.playbackRate,
  }), 2000);
  removers.push(() => window.clearInterval(snapshotTimer));
  if (adapter) removers.push(adapter.attach(emit));
  emit("session_started", { observer: observerName, version: 1 });

  return {
    playRequested,
    flush: () => transport.flush(),
    destroy: () => {
      if (destroyed) return;
      endBuffering();
      emit("session_ended");
      void transport.flush();
      destroyed = true;
      for (const remove of removers.splice(0)) remove();
      transport.closeWithBeacon();
    },
  };
}