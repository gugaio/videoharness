import Hls from "hls.js";
import { useRef, useState } from "react";
import { completePlaybackSession, failPlaybackSession, startPlaybackSession, type PlaybackTelemetry } from "../lib/api";

export function PlaybackValidation({ investigationId }: { investigationId: string }): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "submitted" | "failed">("idle");
  const [note, setNote] = useState("Run an optional 30-second browser playback check.");

  const start = async (): Promise<void> => {
    setStatus("running");
    setNote("Preparing the local browser playback check…");
    const started = await startPlaybackSession(investigationId);
    const startedAt = new Date().toISOString(); const startedMs = Date.now(); const engine: PlaybackTelemetry["engine"] = Hls.isSupported() ? "hls.js" : "native-hls"; let firstPlaying: number | undefined;
    let stalls = 0; let stallStarted: number | undefined; let stallDurationMs = 0; let fragmentsLoaded = 0; let qualitySwitches = 0;
    const errors: PlaybackTelemetry["errors"] = []; const limitations: string[] = [];
    const recordError = (type: string, detail: string, fatal: boolean): void => { if (errors.length < 30) errors.push({ type, detail: detail.slice(0, 160), fatal, atMs: Date.now() - startedMs }); };
    const media = video.current;
    if (!media) return;
    const finish = async (): Promise<void> => {
      if (status === "submitted") return;
      hls.current?.destroy(); hls.current = null;
      const quality = media.getVideoPlaybackQuality?.();
      const telemetry: PlaybackTelemetry = { engine, startedAt, finishedAt: new Date().toISOString(), requestedDurationMs: started.session.requestedDurationMs, playedMs: Math.min(120_000, Math.round(media.currentTime * 1000)), ...(firstPlaying ? { startupTimeMs: firstPlaying - startedMs } : {}), stalls, stallDurationMs, fragmentsLoaded, qualitySwitches, ...(quality ? { droppedFrames: quality.droppedVideoFrames } : {}), errors, limitations };
      try { await completePlaybackSession(investigationId, started.session.id, telemetry); setStatus("submitted"); setNote("Playback evidence submitted. The report will update automatically."); } catch { setStatus("failed"); setNote("The playback ran, but its telemetry could not be saved."); }
    };
    const onPlaying = (): void => { firstPlaying ??= Date.now(); if (stallStarted) { stallDurationMs += Date.now() - stallStarted; stallStarted = undefined; } };
    const onWaiting = (): void => { if (!stallStarted) { stalls += 1; stallStarted = Date.now(); } };
    const onError = (): void => recordError("media", "The browser media element reported an error", true);
    media.addEventListener("playing", onPlaying); media.addEventListener("waiting", onWaiting); media.addEventListener("stalled", onWaiting); media.addEventListener("error", onError);
    const timer = window.setTimeout(() => void finish(), started.session.requestedDurationMs);
    const cleanupFailure = async (code: string, message: string): Promise<void> => { window.clearTimeout(timer); hls.current?.destroy(); hls.current = null; await failPlaybackSession(investigationId, started.session.id, code, message).catch(() => undefined); setStatus("failed"); setNote(message); };
    if (Hls.isSupported()) {
      const instance = new Hls({ enableWorker: true }); hls.current = instance;
      instance.on(Hls.Events.FRAG_LOADED, () => { fragmentsLoaded += 1; });
      instance.on(Hls.Events.LEVEL_SWITCHED, () => { qualitySwitches += 1; });
      instance.on(Hls.Events.ERROR, (_event, data) => { recordError(String(data.type), String(data.details), data.fatal); if (data.fatal) void cleanupFailure("HLS_FATAL_ERROR", "Browser playback could not continue. Confirm that the stream allows this page through CORS."); });
      instance.loadSource(started.sourceUrl); instance.attachMedia(media);
    } else if (media.canPlayType("application/vnd.apple.mpegurl")) {
      media.src = started.sourceUrl;
    } else {
      await cleanupFailure("HLS_NOT_SUPPORTED", "This browser does not support HLS playback."); return;
    }
    media.play().catch(() => { limitations.push("The browser required a manual play action."); });
  };

  return <section className="rounded-3xl border border-sky-300/15 bg-sky-300/[0.04] p-6 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-200/70">Optional browser validation</p><h3 className="mt-2 text-lg font-semibold">Test the stream in this browser</h3><p className="mt-2 max-w-xl text-sm leading-6 text-harness-muted">This plays the reported HLS URL for up to 30 seconds and adds startup, stalls, fragments and bounded HLS errors to the report. The origin must permit browser CORS.</p></div><button className="rounded-xl bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={status === "running" || status === "submitted"} onClick={() => void start()}>{status === "running" ? "Testing…" : status === "submitted" ? "Evidence sent" : "Run playback test"}</button></div><video ref={video} controls className="mt-5 w-full rounded-2xl bg-black/60" /><p className={`mt-3 text-sm ${status === "failed" ? "text-rose-200" : "text-harness-muted"}`}>{note}</p></section>;
}
