import { useAuth } from "@clerk/react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { controlLiveMock, getLiveMock, getStream } from "../api";
import RequestsPanel from "../components/RequestsPanel";
import PlaybackInspector from "../components/PlaybackInspector";
import type { LiveMock, Stream } from "../types";

export default function DashboardPage() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const query = new URLSearchParams(useLocation().search);
  const source = query.get("source") ?? undefined;
  const preset = query.get("preset") ?? undefined;
  const format = query.get("format") ?? undefined;
  const isProxy = !id;
  const [stream, setStream] = useState<Stream | null>(null);
  const [live, setLive] = useState<LiveMock | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const previewParams = new URLSearchParams();
  if (source) previewParams.set("source", source);
  if (preset) previewParams.set("preset", preset);
  if (format) previewParams.set("format", format);
  const previewPath = isProxy
    ? source ? `/preview/proxy?${previewParams.toString()}` : null
    : `/preview/stream/${id}${stream ? `?format=${stream.format}` : ""}`;

  useEffect(() => {
    if (!id) {
      setStream(null);
      return;
    }
    getStream(id).then(setStream).catch(() => setStream(null));
  }, [id]);

  useEffect(() => {
	if (!id || !stream || stream.format !== "hls" || stream.protection_mode !== "clear" || stream.capture_status !== "ready") {
	  setLive(null);
	  return;
	}
	let cancelled = false;
	getToken().then(async (token) => token ? getLiveMock(id, token) : null).then((state) => {
	  if (!cancelled && state) setLive(state);
	}).catch(() => { if (!cancelled) setLive(null); });
	return () => { cancelled = true; };
  }, [getToken, id, stream]);

  async function controlLive(action: "start" | "pause" | "resume" | "restart" | "stop") {
	if (!id) return;
	setLiveBusy(true);
	setLiveError(null);
	try {
	  const token = await getToken();
	  setLive(await controlLiveMock(id, action, token ?? undefined));
	} catch (reason) {
	  setLiveError(reason instanceof Error ? reason.message : "Could not update the live mock.");
	} finally {
	  setLiveBusy(false);
	}
  }

  async function copyPlaybackURL() {
    if (!stream) return;
    try {
      await navigator.clipboard.writeText(new URL(stream.proxy_path, window.location.origin).toString());
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <main className="min-h-screen bg-[#11100f] text-stone-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <Link to="/workspace" className="text-sm font-medium text-white/65 transition hover:text-white">
            ← Back to workspace
          </Link>
          <span className="text-sm font-medium text-white">Stream dashboard</span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">
              {isProxy ? "Live proxy dashboard" : "Clone dashboard"}
            </h1>
            <p className="mt-3 text-sm text-stone-400">The 20 latest requests for this stream.</p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            {!isProxy && stream?.capture_status === "ready" && (
              <button
                type="button"
                onClick={() => void copyPlaybackURL()}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-stone-200 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                {copyState === "copied" ? "Copied!" : "Copy stream URL"}
              </button>
            )}
            {previewPath && (isProxy || stream?.capture_status === "ready") && (
              <a
                href={previewPath}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                Open player preview
              </a>
            )}            
          </div>
        </div>

        {copyState === "error" && <p className="mt-4 text-sm text-red-200">Could not copy the player URL. Please try again.</p>}
		{!isProxy && live && (
		  <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			  <div>
				<h2 className="font-semibold text-white">HLS live mock</h2>
				<p className="mt-1 text-sm text-stone-400">A local rolling HLS window built from this clone. Segments remain local and the origin is never contacted.</p>
			  </div>
			  <span className="rounded-full border border-white/10 px-3 py-1 text-xs capitalize text-amber-100">{live.status}</span>
			</div>
			<div className="mt-4 flex flex-wrap items-center gap-2">
			  {live.status === "stopped" || live.status === "ended" ? <button type="button" disabled={liveBusy} onClick={() => void controlLive("start")} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-stone-950 disabled:opacity-50">Start live mock</button> : <>
				{live.status === "playing" ? <button type="button" disabled={liveBusy} onClick={() => void controlLive("pause")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Pause</button> : <button type="button" disabled={liveBusy} onClick={() => void controlLive("resume")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Resume</button>}
				<button type="button" disabled={liveBusy} onClick={() => void controlLive("restart")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Restart</button>
				<button type="button" disabled={liveBusy} onClick={() => void controlLive("stop")} className="rounded-lg border border-red-300/30 px-3 py-2 text-xs font-semibold text-red-100 disabled:opacity-50">Stop</button>
				<a href={`/preview/stream/${id}?format=hls&live=1`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-stone-950">Open live preview</a>
			  </>}
			  {live.status !== "stopped" && <code className="ml-1 break-all text-xs text-stone-500">{live.playback_path} · sequence {live.sequence}</code>}
			</div>
			{liveError && <p className="mt-3 text-sm text-red-200">{liveError}</p>}
		  </section>
		)}

        <RequestsPanel
          getToken={getToken}
          mode={isProxy ? "proxy" : "clone"}
          streamId={id}
          source={source}
          preset={preset}
        />
		<PlaybackInspector getToken={getToken} streamId={id} source={source} preset={preset} />
      </div>
    </main>
  );
}
