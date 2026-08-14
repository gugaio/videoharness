import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorEvent as DashErrorEvent, MediaPlayerClass } from "dashjs";

type PlayerStatus = "idle" | "checking" | "ready" | "playing" | "stalled" | "unsupported" | "error";
type CodecCapability = { kind: "video" | "audio"; codec: string; supported: boolean };

const STATUS_LABEL: Record<PlayerStatus, string> = {
  idle: "Not started",
  checking: "Checking browser",
  ready: "Ready",
  playing: "Playing",
  stalled: "Buffering",
  unsupported: "Unsupported",
  error: "Playback error",
};

export function RecordingBrowserPlayer({ protocol, url }: { protocol: "hls" | "dash"; url: string }): JSX.Element {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<MediaPlayerClass | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [note, setNote] = useState("Start an explicit browser smoke test when you are ready.");
  const [capabilities, setCapabilities] = useState<CodecCapability[]>([]);

  const destroyPlayers = useCallback((): void => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    dashRef.current?.destroy();
    dashRef.current = null;
    const media = mediaRef.current;
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
  }, []);

  useEffect(() => destroyPlayers, [destroyPlayers, url]);

  const tryPlay = (media: HTMLVideoElement): void => {
    void media.play().catch(() => {
      setStatus("ready");
      setNote("The stream is ready. Press play in the video controls to continue.");
    });
  };

  const startHls = (media: HTMLVideoElement): void => {
    if (Hls.isSupported()) {
      setCapabilities([{ kind: "video", codec: "HLS through Media Source Extensions", supported: true }]);
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("ready");
        setNote("HLS manifest loaded with hls.js. Starting playback…");
        tryPlay(media);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        setStatus("error");
        setNote(`hls.js stopped playback: ${String(data.details)}. Check the request journal and browser console.`);
      });
      hls.attachMedia(media);
      hls.loadSource(url);
      return;
    }

    if (media.canPlayType("application/vnd.apple.mpegurl")) {
      setCapabilities([{ kind: "video", codec: "Native HLS", supported: true }]);
      media.src = url;
      media.load();
      setStatus("ready");
      setNote("Native HLS is available. Starting playback…");
      tryPlay(media);
      return;
    }

    setCapabilities([{ kind: "video", codec: "HLS", supported: false }]);
    setStatus("unsupported");
    setNote("This browser exposes neither Media Source Extensions for hls.js nor native HLS playback.");
  };

  const startDash = async (media: HTMLVideoElement): Promise<void> => {
    const inspected = await inspectDashCapabilities(url);
    setCapabilities(inspected);
    const unsupportedVideo = inspected.find((entry) => entry.kind === "video" && !entry.supported);
    if (unsupportedVideo) {
      setStatus("unsupported");
      setNote(`This browser reports ${unsupportedVideo.codec} as unsupported through Media Source Extensions. No media segments were requested.`);
      return;
    }

    const dash = await import("dashjs");
    const player = dash.MediaPlayer().create();
    dashRef.current = player;
    player.on(dash.MediaPlayer.events.ERROR, (event: DashErrorEvent) => {
      setStatus("error");
      setNote(`dash.js stopped playback: ${dashErrorMessage(event)}`);
    });
    player.on(dash.MediaPlayer.events.STREAM_INITIALIZED, () => {
      setStatus("ready");
      setNote("DASH initialized with dash.js. Starting playback…");
      tryPlay(media);
    });
    player.initialize(media, url, false);
  };

  const start = async (): Promise<void> => {
    const media = mediaRef.current;
    if (!media) return;
    destroyPlayers();
    setCapabilities([]);
    setStatus("checking");
    setNote(`Checking ${protocol.toUpperCase()} support in this browser…`);
    try {
      if (protocol === "hls") startHls(media);
      else await startDash(media);
    } catch (error) {
      setStatus("error");
      setNote(error instanceof Error ? error.message : "Browser playback could not be initialized.");
    }
  };

  const stop = (): void => {
    destroyPlayers();
    setStatus("idle");
    setNote("Browser playback stopped. The recording URL remains available.");
  };

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-sky-300/15 bg-sky-300/[0.035] shadow-card">
      <div className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">Browser smoke test</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight">Play this recording here</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-harness-muted">
              Uses {protocol === "dash" ? "dash.js" : "hls.js or native HLS"} against the same fixed URL copied to external devices. Starting playback creates real delivery requests and participates in the active network profile.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl bg-sky-200 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45" disabled={status === "checking"} onClick={() => void start()}>
              {status === "idle" ? "Test in browser" : status === "checking" ? "Checking…" : "Restart playback"}
            </button>
            {status !== "idle" && <button className="rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/30" onClick={stop}>Stop</button>}
          </div>
        </div>

        <video
          ref={mediaRef}
          className="mt-6 aspect-video w-full rounded-2xl bg-black/70"
          controls
          crossOrigin="anonymous"
          onError={() => {
            const code = mediaRef.current?.error?.code;
            setStatus("error");
            setNote(`The browser media element rejected playback${code ? ` (media error ${code})` : ""}.`);
          }}
          onPlaying={() => {
            setStatus("playing");
            setNote("Playback is running. Requests and ABR selections appear in the journal below.");
          }}
          onStalled={() => {
            setStatus("stalled");
            setNote("Playback is stalled while waiting for media. Compare the selected bitrate with the active shaping stage.");
          }}
          onWaiting={() => {
            setStatus("stalled");
            setNote("Playback is buffering. The active constrained stage may intentionally make a large segment slow.");
          }}
          playsInline
        />

        <div className="mt-4 flex flex-wrap items-center gap-2" aria-live="polite">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(status)}`}>{STATUS_LABEL[status]}</span>
          {capabilities.map((capability) => (
            <span key={`${capability.kind}:${capability.codec}`} className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${capability.supported ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200" : "border-rose-300/20 bg-rose-300/[0.06] text-rose-200"}`}>
              {capability.kind} · {capability.codec} · {capability.supported ? "MSE accepted" : "MSE rejected"}
            </span>
          ))}
        </div>
        <p className={`mt-3 text-sm leading-6 ${status === "error" || status === "unsupported" ? "text-rose-200" : "text-harness-muted"}`}>{note}</p>
        <p className="mt-2 text-xs leading-5 text-white/35">MSE acceptance is a capability check, not proof of successful hardware decode or rendered frames.</p>
      </div>
    </section>
  );
}

async function inspectDashCapabilities(url: string): Promise<CodecCapability[]> {
  if (!("MediaSource" in window)) return [{ kind: "video", codec: "Media Source Extensions", supported: false }];
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`The DASH manifest returned HTTP ${response.status}.`);
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if (xml.getElementsByTagName("parsererror").length > 0) throw new Error("The recorded DASH manifest is not valid XML.");

  const capabilities: CodecCapability[] = [];
  const seen = new Set<string>();
  for (const adaptation of Array.from(xml.getElementsByTagNameNS("*", "AdaptationSet"))) {
    const kind = adaptation.getAttribute("contentType") === "audio" || adaptation.getAttribute("mimeType")?.startsWith("audio/") ? "audio" : "video";
    const representations = Array.from(adaptation.getElementsByTagNameNS("*", "Representation"));
    for (const representation of representations) {
      const codec = representation.getAttribute("codecs") ?? adaptation.getAttribute("codecs");
      if (!codec) continue;
      const key = `${kind}:${codec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mimeType = representation.getAttribute("mimeType") ?? adaptation.getAttribute("mimeType") ?? `${kind}/mp4`;
      capabilities.push({ kind, codec, supported: MediaSource.isTypeSupported(`${mimeType}; codecs="${codec}"`) });
    }
  }
  if (!capabilities.some((entry) => entry.kind === "video")) throw new Error("The DASH manifest does not declare a video codec for browser capability checks.");
  return capabilities;
}

function dashErrorMessage(event: DashErrorEvent): string {
  if (typeof event.error === "object" && event.error && "message" in event.error && typeof event.error.message === "string") return event.error.message;
  if ("event" in event && typeof event.event === "object" && event.event && "message" in event.event && typeof event.event.message === "string") return event.event.message;
  return "the player reported an unsupported capability, manifest, or media segment";
}

function statusTone(status: PlayerStatus): string {
  if (status === "playing") return "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-200";
  if (status === "stalled" || status === "checking" || status === "ready") return "border-amber-300/25 bg-amber-300/[0.08] text-amber-200";
  if (status === "error" || status === "unsupported") return "border-rose-300/25 bg-rose-300/[0.08] text-rose-200";
  return "border-white/15 bg-white/[0.05] text-white/60";
}
