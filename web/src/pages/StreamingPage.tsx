import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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
    getToken()
      .then((t) => setToken(t ?? undefined))
      .catch(() => setToken(undefined));
  }, [getToken, userId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    const url = stream.proxy_path;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
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
              Preset: {stream.active_preset}
            </span>
          </div>

          <video
            ref={videoRef}
            controls
            playsInline
            className="mt-4 aspect-video w-full rounded-lg bg-black"
          />

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {canChangePreset && (
              <PresetSelect
                stream={stream}
                onPresetChange={setStream}
                token={token}
              />
            )}
            <a
              href={stream.proxy_path}
              className="break-all text-xs text-cyan-400 hover:underline"
            >
              {stream.proxy_path}
            </a>
          </div>
          <p className="mt-2 break-all text-xs text-slate-500">
            Original: {stream.original_url}
          </p>
        </div>
      )}
    </main>
  );
}