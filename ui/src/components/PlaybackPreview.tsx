import { useEffect, useRef, useState } from "react";
import { ApiError, createPlaybackSession } from "../api";
import type { CreatedPlaybackSession, StreamFormat } from "../api";

export function PlaybackPreview({
  source,
  streamId,
  preset,
  format = "hls",
  live = false,
}: {
  source?: string;
  streamId?: string;
  preset?: string;
  format?: StreamFormat;
  live?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prepared, setPrepared] = useState<CreatedPlaybackSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPrepared(null);
    setError(null);
    if (!source && !streamId) {
      setError("Informe uma origem ou clone para reproduzir.");
      return () => {
        cancelled = true;
      };
    }
    createPlaybackSession({
      ...(streamId ? { stream_id: streamId } : {}),
      ...(source ? { source } : {}),
      ...(preset ? { preset } : {}),
      format,
      live,
    })
      .then((session) => {
        if (!cancelled) setPrepared(session);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof ApiError ? reason.message : "Falha ao preparar o player.");
      });
    return () => {
      cancelled = true;
    };
  }, [format, live, preset, source, streamId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !prepared) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        if (format === "dash" || prepared.protection_mode === "clearkey") {
          const shaka = (await import("shaka-player")).default;
          const { observePlayback } = await import("@streammock/playback-observer");
          if (cancelled) return;
          const player = new shaka.Player();
          const observer = observePlayback({
            media: video,
            sessionId: prepared.cmcd_session_id,
            ingestUrl: prepared.ingest_url,
          });
          observer.playRequested();
          player.configure({
            cmcd: {
              enabled: true,
              useHeaders: false,
              sessionId: prepared.cmcd_session_id,
              contentId: prepared.content_id,
              version: 1,
            },
            ...(prepared.protection_mode === "clearkey" && prepared.license_url
              ? { drm: { servers: { "org.w3.clearkey": prepared.license_url } } }
              : {}),
          });
          player.addEventListener("error", ((event: Event) => {
            const detail = (event as Event & { detail?: { code?: number; message?: string } }).detail;
            if (!cancelled) {
              setError(`Falha na reprodução${detail?.code ? ` (Shaka ${detail.code})` : ""}: ${detail?.message ?? "erro do player"}`);
            }
          }) as EventListener);
          void player
            .attach(video)
            .then(() => player.load(prepared.playback_url))
            .then(() => video.play())
            .catch((reason: unknown) => {
              if (!cancelled) setError(reason instanceof Error ? `Falha ao iniciar: ${reason.message}` : "Falha ao iniciar a reprodução.");
            });
          cleanup = () => {
            observer.destroy();
            void player.destroy();
          };
          return;
        }

        const Hls = (await import("hls.js")).default;
        const { observePlayback } = await import("@streammock/playback-observer");
        if (cancelled) return;

        if (Hls.isSupported()) {
          const { hlsJsAdapter } = await import("@streammock/playback-observer/hls");
          const hls = new Hls({
            cmcd: {
              sessionId: prepared.cmcd_session_id,
              contentId: prepared.content_id,
              useHeaders: false,
              version: 1,
            },
          });
          const observer = observePlayback({
            media: video,
            adapter: hlsJsAdapter(hls),
            sessionId: prepared.cmcd_session_id,
            ingestUrl: prepared.ingest_url,
          });
          observer.playRequested();
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            void video.play().catch(() => undefined);
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setError(`Falha na reprodução: ${data.details}`);
          });
          hls.loadSource(prepared.playback_url);
          hls.attachMedia(video);
          cleanup = () => {
            observer.destroy();
            hls.destroy();
          };
          return;
        }

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // HLS nativo não emite CMCD, mas o observer continua útil.
          const observer = observePlayback({
            media: video,
            sessionId: prepared.cmcd_session_id,
            ingestUrl: prepared.ingest_url,
          });
          observer.playRequested();
          video.src = prepared.playback_url;
          void video.play().catch(() => undefined);
          cleanup = () => {
            observer.destroy();
            video.pause();
            video.removeAttribute("src");
            video.load();
          };
          return;
        }

        setError(`Este navegador não reproduz ${format.toUpperCase()}.`);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Falha ao carregar o player.");
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [format, prepared]);

  return (
    <section className="pb-player">
      <div className="pb-player-head">
        <h3>Player</h3>
        {prepared && (
          <span className="pb-player-meta">
            sid <code>{prepared.cmcd_session_id.slice(0, 12)}</code>
            {prepared.protection_mode === "clearkey" ? " · ClearKey" : ""}
          </span>
        )}
      </div>
      <video ref={videoRef} controls autoPlay playsInline className="pb-video" />
      {!prepared && !error && <p className="state">Preparando sessão do Inspector…</p>}
      {error && (
        <p role="alert" className="state-error">
          {error}
        </p>
      )}
    </section>
  );
}
