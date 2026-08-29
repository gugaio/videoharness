import { useState } from "react";
import { DEFAULT_PRESETS } from "../types";

export default function OnDemandCard({ slug }: { slug?: string }) {
  const [url, setUrl] = useState("");
  const [preset, setPreset] = useState("clean");
  const [duration, setDuration] = useState(60);
  const [copied, setCopied] = useState(false);

  const origin = window.location.origin;
  const target = url.trim();
  const endpointBase = slug ? `${origin}/ws/${slug}/p.m3u8` : `${origin}/p.m3u8`;
  let endpoint = "";
  if (target) {
    const params = new URLSearchParams({ url: target });
    if (preset !== "clean") params.set("preset", preset);
    if (duration !== 60) params.set("duration", String(duration));
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
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg">⚡</div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            {slug ? "Your on-demand proxy link" : "On-demand proxy link"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-300/70">
            {slug ? (
              <>
                Point any HLS player at your private link and StreamMock proxies it live —
                every request shows up in the activity board below. Nothing is recorded, capped at 300 seconds.
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

      <div className="mt-5 flex flex-col gap-3 lg:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/master.m3u8"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-5 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-100/60 focus:ring-2 focus:ring-amber-100/15"
        />
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-200 outline-none focus:border-amber-100/60"
          aria-label="Playback preset"
        >
          {DEFAULT_PRESETS.map((p) => (
            <option key={p.key} value={p.key} className="bg-zinc-900">
              {p.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-stone-300">
          <span>Seconds</span>
          <input
            type="number"
            min={1}
            max={300}
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(300, Number(e.target.value) || 60)))}
            className="w-14 bg-transparent text-right text-white outline-none"
          />
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

      {endpoint && (
        <p className="mt-3 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xs text-amber-100/80">
          {endpoint}
        </p>
      )}
    </section>
  );
}
