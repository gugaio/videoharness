import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserButton, useAuth } from "@clerk/react";
import { addStream, deleteStream, getWorkspace, listStreams, withPresets } from "../api";
import OnDemandCard from "../components/OnDemandCard";
import PresetSelect from "../components/PresetSelect";
import type { Stream } from "../types";

export default function WorkspacePage() {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | undefined>(undefined);
  const [workspaceSlug, setWorkspaceSlug] = useState<string | undefined>(undefined);
	const [storage, setStorage] = useState<{ used: number; quota: number; ttlHours: number } | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(60);
  const [format, setFormat] = useState<"hls" | "dash">("hls");
	const [protection, setProtection] = useState<"clear" | "clearkey">("clear");
	const [trackSelection, setTrackSelection] = useState<"highest" | "all">("highest");
  const [mode, setMode] = useState<"clone" | "proxy">("proxy");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreatingClone, setIsCreatingClone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clones = streams.filter((stream) => stream.mode === "clone");

  useEffect(() => {
    getToken()
      .then(async (t) => {
        setToken(t ?? undefined);
        const [rows, workspace] = await Promise.all([
          listStreams(t ?? ""),
          getWorkspace(t ?? undefined).catch(() => null),
        ]);
        setStreams(rows.map(withPresets));
		if (workspace) {
		  setWorkspaceSlug(workspace.slug);
		  setStorage({ used: workspace.stored_bytes, quota: workspace.quota_bytes, ttlHours: workspace.clone_ttl_hours });
		}
      })
      .catch((e: Error) => setError(e.message));
  }, [getToken]);

	useEffect(() => {
	  if (!token) return;
	  let cancelled = false;
	  const refresh = async () => {
		try {
		  const [rows, workspace] = await Promise.all([listStreams(token), getWorkspace(token)]);
		  if (cancelled) return;
		  setStreams(rows.map(withPresets));
		  setStorage({ used: workspace.stored_bytes, quota: workspace.quota_bytes, ttlHours: workspace.clone_ttl_hours });
		} catch (reason) {
		  if (!cancelled) setError((reason as Error).message);
		}
	  };
	  const timer = window.setInterval(() => void refresh(), 3000);
	  return () => { cancelled = true; window.clearInterval(timer); };
	}, [token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const created = await addStream(url.trim(), duration, label.trim(), token, format, protection, trackSelection);
      setStreams((prev) => [...prev, withPresets(created)]);
      setUrl("");
      setLabel("");
      setIsCreatingClone(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function replaceStream(updated: Stream) {
    setStreams((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function removeClone(stream: Stream) {
    if (!window.confirm("Delete this clone and its local files? This cannot be undone.")) return;
    try {
      await deleteStream(stream.id, token);
      setStreams((prev) => prev.filter((item) => item.id !== stream.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#11100f] text-stone-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,rgba(116,83,60,0.35),transparent_68%)]" />

      <header className="relative border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <Link to="/" className="text-xl font-medium tracking-[-0.04em] text-white">
            Stream Mock
          </Link>
          <div className="flex items-center gap-5">
            <Link to="/" className="text-sm font-medium text-white/65 transition hover:text-white">
              ← Back to home
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
          Workspace
        </h1>
		{storage && <p className="mt-3 text-sm text-stone-400">Clone storage {(storage.used / 1024 / 1024).toFixed(1)} MiB / {storage.quota > 0 ? `${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GiB` : "unlimited"}{storage.ttlHours > 0 ? ` · expires after ${storage.ttlHours}h` : " · no automatic expiry"}</p>}

        <section className="mt-12 grid gap-4 md:grid-cols-2">
          <button
            type="button"
            aria-pressed={mode === "proxy"}
            onClick={() => setMode("proxy")}
            className={`rounded-3xl border p-6 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-100/60 ${
              mode === "proxy" ? "border-amber-100/70 bg-amber-100/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
            }`}
          >
            <span className="text-sm font-semibold text-white">Live proxy</span>
            <span className="mt-2 block text-sm leading-relaxed text-stone-300/75">
              Test what the origin returns right now, without creating or saving a copy.
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "clone"}
            onClick={() => setMode("clone")}
            className={`rounded-3xl border p-6 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-100/60 ${
              mode === "clone" ? "border-amber-100/70 bg-amber-100/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
            }`}
          >
            <span className="text-sm font-semibold text-white">Clone a stream</span>
            <span className="mt-2 block text-sm leading-relaxed text-stone-300/75">
              Clone a self-contained copy to replay later, even if the origin is unavailable.
            </span>
          </button>
        </section>

        {mode === "clone" ? (
          <>
            {isCreatingClone && <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
              <h2 className="text-lg font-semibold text-white">Clone a new stream</h2>
              <p className="mt-2 text-sm text-stone-300/70">
                StreamMock downloads a self-contained VOD or freezes the latest complete window of a live stream, so playback no longer depends on the origin.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-stone-400">Source URL</span>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      required
                      placeholder="https://example.com/manifest.mpd"
                      className="w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-stone-400">Format</span>
                    <select value={format} onChange={(e) => { const value = e.target.value as "hls" | "dash"; setFormat(value); if (value === "dash") setProtection("clear"); }} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15">
                      <option value="hls" className="bg-zinc-900">HLS</option>
                      <option value="dash" className="bg-zinc-900">DASH</option>
                    </select>
                  </label>
                </div>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                  placeholder="Label (optional)"
                  className="w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15"
                />
                {showAdvanced && (
                  <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/15 p-4 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-stone-400">Capture duration</span>
                      <span className="flex items-center rounded-xl border border-white/10 bg-black/25 px-4 py-3 transition focus-within:border-amber-100/60 focus-within:ring-2 focus-within:ring-amber-100/15">
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={duration}
                          onChange={(e) => setDuration(Math.max(1, Math.min(300, Number(e.target.value) || 60)))}
                          className="w-full min-w-0 bg-transparent text-sm text-white outline-none"
                        />
                        <span className="ml-2 text-xs text-stone-500">sec</span>
                      </span>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-stone-400">Protection</span>
                      <select value={protection} onChange={(e) => { const value = e.target.value as "clear" | "clearkey"; setProtection(value); if (value === "clearkey") setTrackSelection("all"); }} disabled={format === "dash"} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15 disabled:opacity-50">
                        <option value="clear" className="bg-zinc-900">Clear</option>
                        <option value="clearkey" className="bg-zinc-900">ClearKey test DRM</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-stone-400">Tracks</span>
                      <select value={trackSelection} onChange={(e) => setTrackSelection(e.target.value as "highest" | "all")} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15">
                        <option value="highest" className="bg-zinc-900">Highest + default audio</option>
                        <option value="all" className="bg-zinc-900">All video/audio/subtitles</option>
                      </select>
                    </label>
                </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    aria-expanded={showAdvanced}
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="inline-flex items-center gap-1.5 self-start rounded-xl px-3 py-3 text-sm font-medium text-stone-400 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-100/40"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    Advanced options
                  </button>
                  <div className="flex gap-2 sm:ml-auto">
                    <button
                      type="submit"
                      className="flex-1 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60 sm:flex-none"
                    >
                      Clone stream
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingClone(false)}
                      className="rounded-xl px-4 py-3 text-sm font-medium text-stone-400 transition hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            </section>
            }

            {error && <p className="mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

            <section className={`${isCreatingClone ? "mt-10" : "mt-6"} overflow-hidden rounded-3xl border border-white/10 bg-black/15`}>
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-7">
            <div>
              <h2 className="font-semibold text-white">Your cloned streams</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsCreatingClone(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-100 px-4 py-2.5 text-sm font-semibold text-stone-950 shadow-lg shadow-amber-100/10 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-100/60"
            >
              <span className="flex size-5 items-center justify-center rounded-md bg-stone-950/10 text-base leading-none">+</span>
              Add
            </button>
          </div>
          {clones.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/8 text-xl">◌</div>
              <p className="mt-4 font-medium text-stone-200">No streams yet</p>
              <p className="mt-1 text-sm text-stone-400">Your cloned streams will appear here.</p>
            </div>
          ) : (
            <div>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-white/[0.035] text-xs uppercase tracking-[0.14em] text-stone-400">
                  <tr>
                    <th className="hidden px-5 py-4 font-medium md:table-cell">Source URL</th>
                    <th className="px-4 py-4 font-medium sm:px-5">Status</th>
                    <th className="hidden px-5 py-4 font-medium lg:table-cell">Playback preset</th>
                    <th className="px-4 py-4 text-right font-medium sm:px-5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {clones.map((stream) => (
                    <tr key={stream.id} className="transition hover:bg-white/[0.045]">
                      <td className="hidden px-5 py-5 md:table-cell">
                        {stream.label && <span className="mb-1 block truncate text-sm font-medium text-white">{stream.label}</span>}
                        <a href={stream.original_url} className="block truncate font-mono text-xs text-stone-300 transition hover:text-white hover:underline">
                          {stream.original_url}
                        </a>
                      </td>
                      <td className="px-4 py-5 text-xs text-stone-300 sm:px-5">
                        {stream.label && <span className="mb-1 block truncate text-sm font-medium text-white md:hidden">{stream.label}</span>}
                        <span className="mb-1 block uppercase tracking-wide text-amber-100/80">{stream.format}</span>
                        <span className="mt-1 block capitalize">{stream.capture_status}</span>
						{stream.capture_status === "capturing" && <span className="mt-1 block text-amber-200">{stream.capture_progress}%</span>}
                        {stream.duration_seconds !== undefined && <span className="mt-1 block text-stone-500">{stream.duration_seconds.toFixed(1)} s</span>}
						{stream.total_bytes !== undefined && <span className="mt-1 block text-stone-500">{(stream.total_bytes / 1024 / 1024).toFixed(1)} MiB</span>}
						<span className="mt-1 block text-stone-500">{stream.source_live ? "Live snapshot" : "VOD"} · {stream.protection_mode === "clearkey" ? "ClearKey/CENC" : "Clear"} · {stream.video_track_count}V/{stream.audio_track_count}A/{stream.subtitle_track_count}S</span>
						<span className="mt-1 block text-stone-600">Created {new Date(stream.created_at).toLocaleDateString()}</span>
						{stream.expires_at && <span className="mt-1 block text-stone-600">Expires {new Date(stream.expires_at).toLocaleDateString()}</span>}
                        {stream.error_message && <span className="mt-1 block max-w-40 text-red-300">{stream.error_message}</span>}
                      </td>
                      <td className="hidden px-5 py-5 lg:table-cell">
                        <PresetSelect stream={stream} onPresetChange={replaceStream} token={token} />
                      </td>
                      <td className="px-4 py-5 text-right sm:px-5">
                        <div className="flex flex-nowrap items-center justify-end gap-2">
                          <Link to={`/dashboard/stream/${stream.id}`} className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60">
                            Dashboard
                          </Link>
                          <button
                            type="button"
                            disabled={stream.capture_status === "queued" || stream.capture_status === "capturing"}
                            onClick={() => void removeClone(stream)}
                            title="Delete clone"
                            aria-label="Delete clone"
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-red-300/45 bg-red-400/15 text-red-100 transition hover:border-red-200/70 hover:bg-red-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
            </section>
          </>
        ) : (
          <>
            <OnDemandCard slug={workspaceSlug} />
            {error && <p className="mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
