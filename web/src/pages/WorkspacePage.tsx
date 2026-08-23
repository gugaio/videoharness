import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserButton, useAuth } from "@clerk/react";
import { addStream, listStreams, withPresets } from "../api";
import PresetSelect from "../components/PresetSelect";
import type { Stream } from "../types";

export default function WorkspacePage() {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | undefined>(undefined);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedStreamId, setCopiedStreamId] = useState<string | null>(null);

  useEffect(() => {
    getToken()
      .then(async (t) => {
        setToken(t ?? undefined);
        const rows = await listStreams(t ?? "");
        setStreams(rows.map(withPresets));
      })
      .catch((e: Error) => setError(e.message));
  }, [getToken]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const created = await addStream(url.trim(), token);
      setStreams((prev) => [...prev, withPresets(created)]);
      setUrl("");
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
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              Workspace
            </h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-stone-300/80">
              Clone a stream once, then test its playback under different network conditions.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-stone-400">Saved streams</p>
            <p className="mt-1 text-2xl font-semibold text-white">{streams.length}</p>
          </div>
        </div>

        <section className="mt-12 rounded-3xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl text-stone-900">+</div>
            <div>
              <h2 className="text-lg font-semibold text-white">Clone a new stream</h2>
              <p className="mt-1 text-sm text-stone-300/70">Paste an HLS or DASH manifest URL to create a player-ready proxy URL.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://example.com/master.m3u8"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-5 py-4 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15"
            />
            <button
              type="submit"
              className="rounded-xl bg-white px-6 py-4 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              Clone stream
            </button>
          </form>
        </section>

        {error && <p className="mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

        <section className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-black/15">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-5 sm:px-7">
            <div>
              <h2 className="font-semibold text-white">Your streams</h2>
              <p className="mt-1 text-sm text-stone-400">Copy the proxy URL into your own player. Use the preview only when you need to test it here.</p>
            </div>
          </div>
          {streams.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/8 text-xl">◌</div>
              <p className="mt-4 font-medium text-stone-200">No streams yet</p>
              <p className="mt-1 text-sm text-stone-400">Your cloned streams will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-white/[0.035] text-xs uppercase tracking-[0.14em] text-stone-400">
                  <tr>
                    <th className="px-7 py-4 font-medium">Stream</th>
                    <th className="px-5 py-4 font-medium">Source URL</th>
                    <th className="px-5 py-4 font-medium">Playback preset</th>
                    <th className="px-7 py-4 text-right font-medium">Use in your player</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {streams.map((stream) => (
                    <tr key={stream.id} className="transition hover:bg-white/[0.045]">
                      <td className="px-7 py-5">
                        <span className="mb-1 block text-xs text-stone-500">STREAM ID</span>
                        <span className="font-mono text-xs text-stone-200">{stream.id}</span>
                      </td>
                      <td className="max-w-sm px-5 py-5">
                        <a href={stream.original_url} className="block truncate font-mono text-xs text-stone-300 transition hover:text-white hover:underline">
                          {stream.original_url}
                        </a>
                        <a href={stream.proxy_path} className="mt-1 block truncate font-mono text-[11px] text-amber-100/60 transition hover:text-amber-100 hover:underline">
                          Proxy: {stream.proxy_path}
                        </a>
                      </td>
                      <td className="px-5 py-5">
                        <PresetSelect stream={stream} onPresetChange={replaceStream} token={token} />
                      </td>
                      <td className="px-7 py-5 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Link to={`/stream/${stream.id}`} className="text-xs font-medium text-stone-400 transition hover:text-white">
                            Preview
                          </Link>
                          <button
                            type="button"
                            onClick={() => void copyProxyUrl(stream)}
                            className="inline-flex min-w-36 justify-center rounded-lg bg-white px-4 py-2 text-xs font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60"
                          >
                            {copiedStreamId === stream.id ? "Copied!" : "Copy manifest URL"}
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
      </div>
    </main>
  );
}
