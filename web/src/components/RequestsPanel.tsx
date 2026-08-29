import { useEffect, useRef, useState } from "react";
import { getWorkspaceRequests } from "../api";
import type { ProxyRequest } from "../types";

const POLL_INTERVAL_MS = 4000;
const MAX_ROWS = 50;

function statusClass(status: number): string {
  if (status < 300) return "bg-emerald-400/15 text-emerald-300";
  if (status < 400) return "bg-sky-400/15 text-sky-300";
  if (status < 500) return "bg-amber-400/15 text-amber-300";
  return "bg-red-400/15 text-red-300";
}

function kindLabel(kind: ProxyRequest["kind"]): string {
  switch (kind) {
    case "master":
      return "playlist";
    case "variant":
      return "media";
    case "segment":
      return "segment";
    default:
      return "asset";
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RequestsPanel({ token }: { token?: string }) {
  const [requests, setRequests] = useState<ProxyRequest[]>([]);
  const [total24h, setTotal24h] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-render for relative timestamps
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function poll() {
      if (document.visibilityState === "hidden") return;
      try {
        const data = await getWorkspaceRequests(token as string);
        if (!cancelled) {
          setRequests(data.requests);
          setTotal24h(data.total_24h);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    void poll();
    timer.current = window.setInterval(() => {
      void poll();
      setTick((t) => t + 1);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [token]);

  if (!token) return null;

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-black/15">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5 sm:px-7">
        <div>
          <h2 className="font-semibold text-white">Proxy activity</h2>
          <p className="mt-1 text-sm text-stone-400">
            Requests served through your workspace link. Retained for 24 hours, capped at 1,000 rows.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-right backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-stone-400">Distinct URLs / 24h</p>
          <p className="mt-1 text-2xl font-semibold text-white">{total24h}</p>
        </div>
      </div>

      {error && (
        <p className="mx-5 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200 sm:mx-7">
          {error}
        </p>
      )}

      {requests.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/8 text-xl">◌</div>
          <p className="mt-4 font-medium text-stone-200">No proxy requests yet</p>
          <p className="mt-1 text-sm text-stone-400">
            Play something through your on-demand link above and requests will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/10">
          {requests.slice(0, MAX_ROWS).map((req) => (
            <li key={`${req.stream_id} ${req.target_url}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/[0.03] sm:px-7">
              <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(req.status)}`}>
                {req.status}
              </span>
              <span className="hidden shrink-0 rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-stone-300 sm:inline-block">
                {kindLabel(req.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-300" title={req.target_url}>
                {req.target_url}
              </span>
              {req.hit_count > 1 && (
                <span className="shrink-0 rounded-full bg-amber-100/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                  ×{req.hit_count}
                </span>
              )}
              <span className="hidden shrink-0 text-[11px] text-stone-500 md:inline">
                {(req.duration_ms / 1000).toFixed(2)}s · {formatBytes(req.bytes)}
                {req.active_preset !== "clean" && ` · ${req.active_preset}`}
              </span>
              <span className="w-16 shrink-0 text-right text-[11px] text-stone-500">{timeAgo(req.last_seen_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
