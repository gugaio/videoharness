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
  const [streams, setStreams] = useState<Stream[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(60);
  const [mode, setMode] = useState<"clone" | "proxy">("clone");
  const [isCreatingClone, setIsCreatingClone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedStreamId, setCopiedStreamId] = useState<string | null>(null);
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
        if (workspace) setWorkspaceSlug(workspace.slug);
      })
      .catch((e: Error) => setError(e.message));
  }, [getToken]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const created = await addStream(url.trim(), duration, label.trim(), token);
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

  async function copyProxyUrl(stream: Stream) {
    try {
      const playerUrl = new URL(stream.proxy_path, window.location.origin).toString();
      await navigator.clipboard.writeText(playerUrl);
      setCopiedStreamId(stream.id);
      window.setTimeout(() => setCopiedStreamId(null), 2000);
    } catch {
      setError("Could not copy the player URL. Please copy it manually from the stream details.");
    }
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

        <section className="mt-12 grid gap-4 md:grid-cols-2">
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
              Download a self-contained copy to replay later, even if the origin is unavailable.
            </span>
          </button>
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
        </section>

        {mode === "clone" ? (
          <>
            {isCreatingClone && <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
              <h2 className="text-lg font-semibold text-white">Clone a new stream</h2>
              <p className="mt-2 text-sm text-stone-300/70">
                StreamMock downloads a self-contained copy and serves it locally, so you can replay exactly what the CDN returned.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                  placeholder="Label (optional)"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/25 px-5 py-4 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15 sm:w-48"
                />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="https://example.com/master.m3u8"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-5 py-4 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15"
                />
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-stone-300">
                  <span>Capture duration</span>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={duration}
                    onChange={(e) => setDuration(Math.max(1, Math.min(300, Number(e.target.value) || 60)))}
                    className="w-14 bg-transparent text-right text-white outline-none"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-xl bg-white px-6 py-4 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60"
                >
                  Clone stream
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingClone(false)}
                  className="rounded-xl px-4 py-4 text-sm font-medium text-stone-400 transition hover:text-white"
                >
                  Cancel
                </button>
              </form>
            </section>
            }

            {error && <p className="mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

            <section className={`${isCreatingClone ? "mt-10" : "mt-6"} overflow-hidden rounded-3xl border border-white/10 bg-black/15`}>
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-7">
            <div>
              <h2 className="font-semibold text-white">Your cloned streams</h2>
              <p className="mt-1 text-sm text-stone-400">Copy the clone URL into your own player. Use the preview only when you need to test it here.</p>
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
                    <th className="px-4 py-4 text-right font-medium sm:px-5">Use in your player</th>
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
                        <a href={stream.proxy_path} className="mt-1 block truncate font-mono text-[11px] text-amber-100/60 transition hover:text-amber-100 hover:underline">
                          Playback: {stream.proxy_path}
                        </a>
                      </td>
                      <td className="px-4 py-5 text-xs text-stone-300 sm:px-5">
                        {stream.label && <span className="mb-1 block truncate text-sm font-medium text-white md:hidden">{stream.label}</span>}
                        <span className="mt-1 block capitalize">{stream.capture_status}</span>
                        {stream.duration_seconds !== undefined && <span className="mt-1 block text-stone-500">{stream.duration_seconds.toFixed(1)} s</span>}
                        {stream.error_message && <span className="mt-1 block max-w-40 text-red-300">{stream.error_message}</span>}
                      </td>
                      <td className="hidden px-5 py-5 lg:table-cell">
                        <PresetSelect stream={stream} onPresetChange={replaceStream} token={token} />
                      </td>
                      <td className="px-4 py-5 text-right sm:px-5">
                        <div className="flex flex-nowrap items-center justify-end gap-2">
                          <Link to={`/stream/${stream.id}`} title="Preview" aria-label="Preview" className="hidden size-9 items-center justify-center rounded-lg border border-sky-300/20 bg-sky-300/5 text-sky-200 transition hover:border-sky-300/45 hover:bg-sky-300/15 sm:inline-flex">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                          </Link>
                          <Link to={`/dashboard/stream/${stream.id}`} title="Open dashboard" aria-label="Open dashboard" className="inline-flex size-9 items-center justify-center rounded-lg border border-amber-200/25 bg-amber-100/10 text-amber-100 transition hover:border-amber-100/55 hover:bg-amber-100/20">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true"><path d="M4 19V5m0 14h16" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></svg>
                          </Link>
                          <button
                            type="button"
                            disabled={stream.capture_status !== "ready"}
                            onClick={() => void copyProxyUrl(stream)}
                            title={copiedStreamId === stream.id ? "Copied" : "Copy playback URL"}
                            aria-label={copiedStreamId === stream.id ? "Copied" : "Copy playback URL"}
                            className="inline-flex size-9 items-center justify-center rounded-lg bg-white text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {copiedStreamId === stream.id ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /></svg>}
                          </button>
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
