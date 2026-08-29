import { useAuth } from "@clerk/react";
import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPlaybackSession } from "../api";
import { hlsJsAdapter, observePlayback } from "../lib/playback-observer";
import type { CreatedPlaybackSession } from "../types";

export default function ProxyPreviewPage() {
  const { getToken } = useAuth();
  const query = new URLSearchParams(useLocation().search);
  const source = query.get("source")?.trim() ?? "";
  const preset = query.get("preset") ?? "clean";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prepared, setPrepared] = useState<CreatedPlaybackSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dashboardParams = new URLSearchParams();
  if (source) dashboardParams.set("source", source);
  if (preset) dashboardParams.set("preset", preset);
  const dashboardPath = `/dashboard/proxy?${dashboardParams.toString()}`;

  useEffect(() => {
    let cancelled = false;
    setPrepared(null);
    setError(null);

    if (!source) {
      setError("No source URL was provided for this preview.");
      return () => {
        cancelled = true;
      };
    }

    getToken()
      .then(async (token) => {
        if (!token) throw new Error("Authentication is required to create an Inspector session.");
        const session = await createPlaybackSession(token, { source, preset, allowed_origin: window.location.origin });
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
  }, [getToken, preset, source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !prepared) return;

    if (Hls.isSupported()) {
	  const hls = new Hls({ cmcd: { sessionId: prepared.cmcd_session_id, contentId: prepared.content_id, useHeaders: false, version: 1 } });
	  const observer = observePlayback({ media: video, adapter: hlsJsAdapter(hls), sessionId: prepared.cmcd_session_id, ingestUrl: prepared.ingest_url });
	  hls.loadSource(prepared.playback_url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
		observer.playRequested();
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(`Playback failed: ${data.details}`);
      });
	  return () => { observer.destroy(); hls.destroy(); };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
	  // Native HLS cannot be configured to emit CMCD, but the Observer remains
	  // useful and stays fail-open.
	  const observer = observePlayback({ media: video, sessionId: prepared.cmcd_session_id, ingestUrl: prepared.ingest_url });
	  video.src = prepared.playback_url;
	  observer.playRequested();
      void video.play().catch(() => undefined);
      return () => {
		observer.destroy();
		video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    setError("This browser cannot play HLS streams.");
  }, [prepared]);

  return (
    <main className="min-h-screen bg-[#11100f] text-stone-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6 lg:px-10">
          <Link to={dashboardPath} className="text-sm font-medium text-white/65 transition hover:text-white">
            ← Back to dashboard
          </Link>
          <span className="text-sm font-medium text-white">Proxy player preview</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">Player preview</h1>
            <p className="mt-3 text-sm text-stone-400">
              Playback requests from this tab will appear in the proxy dashboard.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-stone-300">
            Preset: {preset}
          </span>
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
