import { useEffect, useRef, useState } from "react";
import { clearWorkspaceRequests, getWorkspaceRequests } from "../api";
import type { ProxyRequest } from "../types";

const POLL_INTERVAL_MS = 4000;
const MAX_ROWS = 20;

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

function rangeClass(result: ProxyRequest["range_result"]): string {
  if (result === "satisfied") return "bg-emerald-400/15 text-emerald-300";
  if (result === "ignored" || result === "missing_content_range" || result === "failed") return "bg-red-400/15 text-red-200";
  return "bg-white/8 text-stone-400";
}

function interventionDescription(req: ProxyRequest): string | null {
  const effects: string[] = [];
  if ((req.added_latency_ms ?? 0) > 0) {
    const seconds = ((req.added_latency_ms ?? 0) / 1000)
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
    effects.push(`+${seconds}s latency`);
  }
  if ((req.injected_status ?? 0) > 0) {
    effects.push(`HTTP ${req.injected_status} injected`);
  }
  return effects.length > 0 ? effects.join(" · ") : null;
}

function originResponse(req: ProxyRequest): string {
  if (req.injected_status) return "Not contacted — response injected by StreamMock";
  if (req.upstream_status) {
    return `${req.upstream_status}${req.content_range ? ` · ${req.content_range}` : ""}`;
  }
  return `${req.status}`;
}

function cmcdLabel(req: ProxyRequest): string {
	if (!req.cmcd) return "CMCD absent";
	return req.cmcd.valid ? "CMCD valid" : "CMCD invalid";
}

function cmcdClass(req: ProxyRequest): string {
	if (!req.cmcd) return "bg-white/8 text-stone-400";
	return req.cmcd.valid ? "bg-sky-400/15 text-sky-200" : "bg-red-400/15 text-red-200";
}

function cmcdErrors(req: ProxyRequest): string {
	return (req.cmcd?.validation_errors ?? []).map((issue) => typeof issue === "string" ? issue : `${issue.code}${issue.key ? `:${issue.key}` : ""}`).join(", ");
}

export default function RequestsPanel({ getToken, mode, streamId, source, preset }: { getToken: () => Promise<string | null>; mode: "proxy" | "clone"; streamId?: string; source?: string; preset?: string }) {
  const [requests, setRequests] = useState<ProxyRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<number | null>(null);
  const [, setTick] = useState(0); // re-render for relative timestamps
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.visibilityState === "hidden") return;
      try {
        // Clerk rotates session JWTs. Fetch a current token for each poll instead
        // of repeatedly using the token that was current when the page mounted.
        const token = await getToken();
        if (!token) return;
        const data = await getWorkspaceRequests(token, mode, streamId, source, preset);
        if (!cancelled) {
          setRequests(data.requests);
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
  }, [getToken, mode, preset, source, streamId]);

  const title = mode === "clone" ? "Clone activity" : "Proxy activity";
  const emptyTitle = mode === "clone" ? "No clone requests yet" : "No proxy requests yet";
  const emptyDescription = mode === "clone"
    ? "Play a cloned stream and its most recent requests will appear here."
    : "Open the player preview in a separate tab, or use the live proxy URL in your own player. Requests will appear here.";

  async function clearActivity() {
    if (!window.confirm("Clear this stream's activity history?")) return;
    try {
      const token = await getToken();
      if (!token) return;
      await clearWorkspaceRequests(token, mode, streamId, source, preset);
      setRequests([]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-black/15">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5 sm:px-7">
        <div>
          <h2 className="font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-stone-400">
            The 20 most recent requests served through this workspace. Retained for 24 hours, capped at 1,000 rows.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-right backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-stone-400">Showing</p>
          <p className="mt-1 text-2xl font-semibold text-white">{requests.length}</p>
        </div>
        <button type="button" onClick={() => void clearActivity()} disabled={requests.length === 0} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-stone-300 transition hover:border-red-300/45 hover:bg-red-400/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-40">Clear activity</button>
      </div>

      {error && (
        <p className="mx-5 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200 sm:mx-7">
          {error}
        </p>
      )}

      {requests.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/8 text-xl">◌</div>
          <p className="mt-4 font-medium text-stone-200">{emptyTitle}</p>
          <p className="mt-1 text-sm text-stone-400">
            {emptyDescription}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/10">
          {requests.slice(0, MAX_ROWS).map((req, index) => (
			<li key={req.id || `${req.stream_id} ${req.target_url} ${req.last_seen_at} ${index}`}>
              <button type="button" onClick={() => setExpandedRequest(expandedRequest === index ? null : index)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-white/[0.03] sm:px-7">
                <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(req.status)}`}>{req.status}</span>
                <span className="hidden shrink-0 rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-stone-300 sm:inline-block">{kindLabel(req.kind)}</span>
				<span className={`hidden shrink-0 rounded-full px-2 py-1 text-[10px] font-medium lg:inline ${cmcdClass(req)}`}>{cmcdLabel(req)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-stone-300" title={req.target_url}>{req.target_url}</span>
                  {interventionDescription(req) && (
                    <span className={`mt-1 inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${req.injected_status ? "bg-red-400/15 text-red-200" : "bg-amber-400/15 text-amber-200"}`}>
                      Server intervention: {interventionDescription(req)}
                    </span>
                  )}
				  <span className="mt-1 flex gap-1">
					{req.cmcd?.startup && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">su · urgent</span>}
					{req.cmcd?.buffer_starvation && <span className="rounded bg-red-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-200">bs · starvation</span>}
				  </span>
                </span>
                <span className="hidden shrink-0 text-[11px] text-stone-500 md:inline">{(req.duration_ms / 1000).toFixed(2)}s · {formatBytes(req.bytes)}{req.active_preset !== "clean" && ` · ${req.active_preset}`}</span>
                {req.client_range && <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium lg:inline ${rangeClass(req.range_result)}`}>Range: {req.range_result}</span>}
                <span className="w-16 shrink-0 text-right text-[11px] text-stone-500">{timeAgo(req.last_seen_at)}</span>
              </button>
			  {expandedRequest === index && <div className="border-t border-white/10 bg-white/[0.025] px-5 py-4 sm:px-7">
				<div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
				  <Detail label="Player Range" value={req.client_range || "Not requested"} /><Detail label="Forwarded Range" value={req.forwarded_range || "Not forwarded"} /><Detail label="Origin response" value={originResponse(req)} /><Detail label="Response size" value={(req.content_length ?? 0) > 0 ? formatBytes(req.content_length ?? 0) : formatBytes(req.bytes)} />
				  <Detail label="CMCD status" value={cmcdLabel(req)} /><Detail label="sid" value={req.cmcd?.sid ?? "Not correlated"} /><Detail label="ot · br" value={`${req.cmcd?.ot ?? "—"} · ${req.cmcd?.br_kbps ?? "—"} kbps`} /><Detail label="bl · dl" value={`${req.cmcd?.bl_ms ?? "—"} ms · ${req.cmcd?.dl_ms ?? "—"} ms`} />
				  <Detail label="mtp" value={req.cmcd?.mtp_kbps != null ? `${req.cmcd.mtp_kbps} kbps` : "—"} /><Detail label="Origin timings" value={`DNS ${req.dns_ms ?? "—"} · TCP ${req.connect_ms ?? "—"} · TLS ${req.tls_ms ?? "—"} · TTFB ${req.ttfb_ms ?? "—"} · relay ${req.relay_ms ?? "—"} ms`} />
				  {interventionDescription(req) && <Detail label="Server intervention" value={interventionDescription(req) ?? ""} />}
				</div>
				{req.cmcd && <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${cmcdClass(req)}`}><span className="font-semibold">CMCD normalized:</span> <span className="font-mono">{req.cmcd.canonical_value || req.cmcd.raw_value || "partial payload"}</span>{cmcdErrors(req) && <span className="ml-2">Errors: {cmcdErrors(req)}</span>}</div>}
				<div className={`mt-3 rounded-lg px-3 py-2 text-xs ${rangeClass(req.range_result)}`}><span className="font-semibold">Range result: {req.range_result}</span>{req.diagnostic && <span className="ml-2">{req.diagnostic}</span>}</div>
			  </div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-stone-500">{label}</p><p className="mt-1 break-all font-mono text-stone-200">{value}</p></div>;
}
