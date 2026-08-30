import { useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_PRESETS } from "../types";

export default function OnDemandCard({ slug }: { slug?: string }) {
  const [url, setUrl] = useState("");
  const [preset, setPreset] = useState("clean");
  const [copied, setCopied] = useState(false);
  const selectedPreset = DEFAULT_PRESETS.find((item) => item.key === preset) ?? DEFAULT_PRESETS[0];

  const origin = window.location.origin;
  const target = url.trim();
  const endpointBase = slug ? `${origin}/ws/${slug}/p.m3u8` : `${origin}/p.m3u8`;
  let endpoint = "";
  if (target) {
    const params = new URLSearchParams({ url: target });
    if (preset !== "clean") params.set("preset", preset);
    endpoint = `${endpointBase}?${params.toString()}`;
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md sm:p-7">
      <div className="flex items-start gap-4">
        <div>
          <p className="mt-1 max-w-2xl text-sm text-stone-300/70">
            {slug ? (
              <>
                Paste an HLS URL, optionally choose a playback preset, then copy the proxy URL into your player.
              </>
            ) : (
              <>
                Shareable playback without a workspace: point any HLS player at
                <code className="mx-1 rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-amber-100/90">{origin}/p.m3u8?url=…</code>
                and StreamMock proxies it live — nothing is recorded, capped at 300 seconds.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 lg:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/master.m3u8"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-5 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15"
        />
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-stone-300">
          <span className="sr-only">Playback condition</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="bg-transparent text-sm text-stone-200 outline-none"
            aria-label="Playback condition"
          >
            {DEFAULT_PRESETS.map((p) => (
              <option key={p.key} value={p.key} className="bg-zinc-900">
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!endpoint}
          onClick={() => void copyEndpoint()}
          className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {!endpoint ? "Paste a URL first" : copied ? "Copied!" : "Copy player URL"}
        </button>
      </div>

      <p className="mt-2 text-xs text-stone-400">
        <span className="font-medium text-stone-300">{selectedPreset.label}:</span> {selectedPreset.description}
      </p>
      {endpoint && (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xs text-amber-100/80">{endpoint}</p>
          {slug && <Link to={`/dashboard/proxy?source=${encodeURIComponent(target)}&preset=${encodeURIComponent(preset)}`} className="shrink-0 rounded-xl border border-white/15 px-4 py-3 text-center text-xs font-semibold text-stone-200 transition hover:bg-white/10 hover:text-white">Open dashboard</Link>}
        </div>
      )}
    </section>
  );
}
