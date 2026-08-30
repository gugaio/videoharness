import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import shaka from "shaka-player";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { getStream } from "../api";
import PresetSelect from "../components/PresetSelect";
import type { Stream } from "../types";

export default function StreamingPage() {
  const { id = "" } = useParams();
  const { getToken, userId, isSignedIn } = useAuth();
  const [stream, setStream] = useState<Stream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    getStream(id)
      .then(setStream)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!stream || stream.capture_status === "ready" || stream.capture_status === "failed") return;
    const timer = window.setInterval(() => {
      getStream(id).then(setStream).catch((e: Error) => setError(e.message));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [id, stream]);

  useEffect(() => {
    getToken()
      .then((t) => setToken(t ?? undefined))
      .catch(() => setToken(undefined));
  }, [getToken, userId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || stream.capture_status !== "ready") return;

    const url = stream.proxy_path;
    let hls: Hls | null = null;
    let shakaPlayer: InstanceType<typeof shaka.Player> | null = null;

    if (stream.format === "dash" || stream.protection_mode === "clearkey") {
      shakaPlayer = new shaka.Player();
	  if (stream.protection_mode === "clearkey" && stream.license_path) {
		shakaPlayer.configure({ drm: { servers: { "org.w3.clearkey": new URL(stream.license_path, window.location.origin).toString() } } });
	  }
      void shakaPlayer.attach(video).then(() => shakaPlayer?.load(url)).then(() => video.play()).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not play the protected stream."));
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play();
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    }

    return () => {
      if (hls) hls.destroy();
      if (shakaPlayer) void shakaPlayer.destroy();
    };
  }, [stream]);

  const canChangePreset =
    !stream || stream.owner_id === null || stream.owner_id === userId;

  const backTo = isSignedIn ? "/workspace" : "/";

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16">
        <p className="text-red-400">Failed to load stream: {error}</p>
        <Link to={backTo} className="mt-4 inline-block text-sm text-cyan-400 hover:underline">
          ← Back {isSignedIn ? "to workspace" : "home"}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <Link to={backTo} className="text-sm text-cyan-400 hover:underline">
        ← Back {isSignedIn ? "to workspace" : "home"}
      </Link>

      {stream && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="break-all text-lg font-semibold">Stream {stream.id}</h1>
            <span className="shrink-0 rounded-full bg-cyan-600/20 px-3 py-1 text-xs font-medium text-cyan-300">
              {stream.capture_status === "ready" ? `Preset: ${stream.active_preset}` : `Clone: ${stream.capture_status}`}
            </span>
          </div>

          {stream.capture_status === "ready" ? (
            <video
              ref={videoRef}
              controls
              playsInline
              className="mt-4 aspect-video w-full rounded-lg bg-black"
            />
          ) : (
            <div className="mt-4 flex aspect-video items-center justify-center rounded-lg bg-black px-6 text-center text-sm text-slate-300">
              {stream.capture_status === "failed"
                ? stream.error_message || "The clone could not be captured."
                : `Capturing up to ${stream.requested_duration_seconds} seconds locally. This page will start the player when it is ready.`}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {stream.capture_status === "ready" && canChangePreset && (
              <PresetSelect
                stream={stream}
                onPresetChange={setStream}
                token={token}
              />
            )}
            {stream.capture_status === "ready" && (
              <a
                href={stream.proxy_path}
                className="break-all text-xs text-cyan-400 hover:underline"
              >
                {stream.proxy_path}
              </a>
            )}
          </div>
          {stream.duration_seconds !== undefined && (
            <p className="mt-2 text-xs text-slate-400">
              Stored locally: {stream.duration_seconds.toFixed(1)} seconds
              {stream.total_bytes !== undefined ? ` · ${(stream.total_bytes / 1024 / 1024).toFixed(1)} MiB` : ""}
			  {` · ${stream.video_track_count} video / ${stream.audio_track_count} audio / ${stream.subtitle_track_count} subtitle tracks`}
			  {stream.source_live ? " · captured from the latest complete live window" : ""}
            </p>
          )}
		  {stream.protection_mode === "clearkey" && <p className="mt-2 text-xs text-amber-300">ClearKey/CENC test clone · license requests use {stream.license_path}</p>}
          <p className="mt-2 break-all text-xs text-slate-500">
            Original: {stream.original_url}
          </p>
        </div>
      )}
    </main>
  );
}
