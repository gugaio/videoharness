import { useAuth } from "@clerk/react";
import Hls from "hls.js";
import shaka from "shaka-player";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { createPlaybackSession } from "../api";
import { observePlayback } from "@streammock/playback-observer";
import { hlsJsAdapter } from "@streammock/playback-observer/hls";
import { shakaAdapter } from "@streammock/playback-observer/shaka";
import type { CreatedPlaybackSession } from "../types";

export default function ProxyPreviewPage() {
  const { getToken } = useAuth();
  const { id } = useParams();
  const query = new URLSearchParams(useLocation().search);
  const source = query.get("source")?.trim() ?? "";
  const preset = query.get("preset") ?? "clean";
  const format = (query.get("format") ?? (source.toLowerCase().split("?")[0].endsWith(".mpd") ? "dash" : "hls")) as "hls" | "dash";
  const isClone = Boolean(id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prepared, setPrepared] = useState<CreatedPlaybackSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dashboardParams = new URLSearchParams();
  if (source) dashboardParams.set("source", source);
  if (preset) dashboardParams.set("preset", preset);
  if (format) dashboardParams.set("format", format);
  const dashboardPath = isClone ? `/dashboard/stream/${id}` : `/dashboard/proxy?${dashboardParams.toString()}`;

  useEffect(() => {
    let cancelled = false;
    setPrepared(null);
    setError(null);

    if (!source && !id) {
      setError("No source URL was provided for this preview.");
      return () => {
        cancelled = true;
      };
    }

    getToken()
      .then(async (token) => {
        if (!token) throw new Error("Authentication is required to create an Inspector session.");
        const session = await createPlaybackSession(token, isClone
          ? { stream_id: id, allowed_origin: window.location.origin }
          : { source, preset, format, allowed_origin: window.location.origin });
        if (!cancelled) setPrepared(session);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not prepare the player preview.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [format, getToken, id, isClone, preset, source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !prepared) return;

	if (format === "dash") {
	  let cancelled = false;
	  const player = new shaka.Player();
	  const observer = observePlayback({ media: video, adapter: shakaAdapter(player), sessionId: prepared.cmcd_session_id, ingestUrl: prepared.ingest_url });
	  observer.playRequested();
	  player.configure({ cmcd: { enabled: true, useHeaders: false, sessionId: prepared.cmcd_session_id, contentId: prepared.content_id, version: 1 } });
	  player.addEventListener("error", ((event: Event) => {
	    const detail = (event as Event & { detail?: { code?: number; message?: string } }).detail;
	    if (!cancelled) setError(`Playback failed${detail?.code ? ` (Shaka ${detail.code})` : ""}: ${detail?.message ?? "an unrecoverable player error"}`);
	  }) as EventListener);
	  void player.attach(video).then(() => player.load(prepared.playback_url)).then(() => video.play()).catch((reason: unknown) => {
	    if (!cancelled) setError(reason instanceof Error ? `Playback failed: ${reason.message}` : "Playback failed to start.");
	  });
	  return () => { cancelled = true; observer.destroy(); void player.destroy(); };
	}

    if (Hls.isSupported()) {
	  const hls = new Hls({ cmcd: { sessionId: prepared.cmcd_session_id, contentId: prepared.content_id, useHeaders: false, version: 1 } });
	  const observer = observePlayback({ media: video, adapter: hlsJsAdapter(hls), sessionId: prepared.cmcd_session_id, ingestUrl: prepared.ingest_url });
	  // Autoplay is the playback intent that starts this session. Record it
	  // before HLS.js begins loading the manifest so startup includes manifest
	  // loading and parsing.
	  observer.playRequested();
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => undefined);
      });
	  hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(`Playback failed: ${data.details}`);
      });
	  hls.loadSource(prepared.playback_url);
	  hls.attachMedia(video);
	  return () => { observer.destroy(); hls.destroy(); };
    }

	if (video.canPlayType("application/vnd.apple.mpegurl")) {
	  // Native HLS cannot be configured to emit CMCD, but the Observer remains
	  // useful and stays fail-open.
	  const observer = observePlayback({ media: video, sessionId: prepared.cmcd_session_id, ingestUrl: prepared.ingest_url });
	  observer.playRequested();
	  video.src = prepared.playback_url;
      void video.play().catch(() => undefined);
      return () => {
		observer.destroy();
		video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    setError(`This browser cannot play ${format.toUpperCase()} streams.`);
  }, [format, prepared]);

  return (
    <main className="min-h-screen bg-[#11100f] text-stone-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6 lg:px-10">
          <Link to={dashboardPath} className="text-sm font-medium text-white/65 transition hover:text-white">
            ← Back to dashboard
          </Link>
          <span className="text-sm font-medium text-white">{isClone ? "Clone" : "Proxy"} player preview</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">Player preview</h1>
            <p className="mt-3 text-sm text-stone-400">
              Playback requests from this tab will appear in the {isClone ? "clone" : "proxy"} dashboard.
            </p>
          </div>
          {!isClone && <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-stone-300">
            Preset: {preset}
          </span>}
        </div>

        <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-black/30">
          <video ref={videoRef} controls autoPlay playsInline className="aspect-video w-full bg-black" />
        </section>

		{!prepared && !error && <p className="mt-4 text-sm text-stone-400">Preparing Inspector session…</p>}
        {error && (
          <p className="mt-4 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
        {source && <p className="mt-4 break-all font-mono text-xs text-stone-500">Source: {source}</p>}
		{prepared && <p className="mt-2 break-all font-mono text-xs text-stone-500">CMCD sid: {prepared.cmcd_session_id} · Observer connected with the same session ID</p>}
      </div>
    </main>
  );
}
