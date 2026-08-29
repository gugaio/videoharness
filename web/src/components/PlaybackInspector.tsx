import { useEffect, useMemo, useRef, useState } from "react";
import { exportPlaybackSession, getPlaybackTimeline, listPlaybackSessions } from "../api";
import type { Finding, PlaybackEvent, PlaybackTimeline, RequestPoint, SessionListItem } from "../types";

const POLL_MS = 4000;

function formatMS(value?: number): string { return value == null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`; }
function formatKbps(value?: number): string { return value == null ? "—" : `${Math.round(value).toLocaleString()} kbps`; }
function severityClass(value: Finding["severity"]): string {
	if (value === "error") return "border-red-300/25 bg-red-400/10 text-red-100";
	if (value === "warning") return "border-amber-300/25 bg-amber-400/10 text-amber-100";
	return "border-sky-300/20 bg-sky-400/10 text-sky-100";
}

const hiddenObserverTypes = new Set(["media_snapshot", "visibility_changed", "buffer_appended", "fragment_parsed"]);
const fragmentLifecycleTypes = new Set(["fragment_loading", "fragment_loaded", "fragment_parsed", "fragment_buffered"]);

interface DisplayEvent extends PlaybackEvent {
	count?: number;
	stages?: string[];
}

function fragmentKey(event: PlaybackEvent): string | null {
	if (!fragmentLifecycleTypes.has(event.event_type) || !event.payload_json) return null;
	try {
		const payload = JSON.parse(event.payload_json) as { frag?: { sn?: number; level?: number } };
		if (payload.frag?.sn == null) return null;
		return `${payload.frag.level ?? "?"}:${payload.frag.sn}`;
	} catch {
		return null;
	}
}

function compactObserverEvents(events: PlaybackEvent[], showTechnical: boolean): { visible: DisplayEvent[]; hidden: number } {
	const visible: DisplayEvent[] = [];
	const fragments = new Map<string, DisplayEvent>();
	let hidden = 0;
	for (const event of events) {
		if (!showTechnical && hiddenObserverTypes.has(event.event_type) && !fragmentLifecycleTypes.has(event.event_type)) {
			hidden += 1;
			continue;
		}
		const key = fragmentKey(event);
		if (key) {
			const existing = fragments.get(key);
			if (existing) {
				existing.stages = [...(existing.stages ?? []), event.event_type.replace("fragment_", "")];
				existing.wall_time_ms = event.wall_time_ms;
				existing.buffer_ahead_ms = event.buffer_ahead_ms;
				continue;
			}
			const lifecycle: DisplayEvent = { ...event, event_type: "fragment_lifecycle", stages: [event.event_type.replace("fragment_", "")] };
			fragments.set(key, lifecycle);
			visible.push(lifecycle);
			continue;
		}
		const previous = visible[visible.length - 1];
		if (previous && previous.event_type === event.event_type && event.wall_time_ms - previous.wall_time_ms < 1000 && ["fragment_loading", "fragment_loaded", "level_switching"].includes(event.event_type)) {
			previous.count = (previous.count ?? 1) + 1;
			previous.wall_time_ms = event.wall_time_ms;
			previous.buffer_ahead_ms = event.buffer_ahead_ms;
			continue;
		}
		visible.push({ ...event });
	}
	return { visible, hidden };
}

function eventLabel(event: DisplayEvent): string {
	if (event.event_type === "fragment_lifecycle") return `fragment ${event.stages?.join(" → ") ?? "lifecycle"}`;
	return event.event_type.replaceAll("_", " ");
}

function findingGroups(findings: Finding[]): Finding[] {
	const groups = new Map<string, Finding>();
	for (const finding of findings) {
		const key = `${finding.rule_id}:${finding.rule_version}`;
		const current = groups.get(key);
		if (!current) {
			groups.set(key, { ...finding, occurrences: finding.occurrences ?? 1, evidence: [...(finding.evidence ?? [])] });
			continue;
		}
		current.occurrences = (current.occurrences ?? 1) + (finding.occurrences ?? 1);
		const evidence = new Map((current.evidence ?? []).map((item) => [`${item.kind}:${item.id}`, item]));
		for (const item of finding.evidence ?? []) evidence.set(`${item.kind}:${item.id}`, item);
		current.evidence = [...evidence.values()].slice(0, 12);
	}
	return [...groups.values()];
}

function isContextFinding(finding: Finding): boolean {
	return finding.rule_id === "urgent_request" || finding.rule_id === "throughput_perception_divergence" ||
		(finding.rule_id === "buffer_exhaustion_risk" && finding.confidence !== "high") ||
		(finding.rule_id === "bitrate_above_throughput" && finding.confidence !== "high") ||
		(finding.rule_id === "deadline_miss" && finding.confidence !== "high") || finding.rule_id === "invalid_cmcd";
}

export default function PlaybackInspector({ getToken, streamId, source, preset }: { getToken: () => Promise<string | null>; streamId?: string; source?: string; preset?: string }) {
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [selectedID, setSelectedID] = useState<string>("");
	const [timeline, setTimeline] = useState<PlaybackTimeline | null>(null);
	const [findings, setFindings] = useState<Finding[]>([]);
	const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
	const [showTechnicalEvents, setShowTechnicalEvents] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timer = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function poll() {
			if (document.visibilityState === "hidden") return;
			try {
				const token = await getToken(); if (!token) return;
				const next = await listPlaybackSessions(token, { stream: streamId, source, preset });
				if (cancelled) return;
				setSessions(next);
				setSelectedID((current) => current && next.some((item) => item.session.id === current) ? current : (next[0]?.session.id ?? ""));
				setError(null);
			} catch (reason) { if (!cancelled) setError((reason as Error).message); }
		}
		void poll(); timer.current = window.setInterval(() => void poll(), POLL_MS);
		return () => { cancelled = true; if (timer.current !== null) window.clearInterval(timer.current); };
	}, [getToken, preset, source, streamId]);

	useEffect(() => {
		let cancelled = false;
		if (!selectedID) { setTimeline(null); setFindings([]); return; }
		async function load() {
			try {
				const token = await getToken(); if (!token) return;
				const data = await getPlaybackTimeline(token, selectedID);
				if (!cancelled) { setTimeline(data.timeline); setFindings(data.findings ?? []); }
			} catch (reason) { if (!cancelled) setError((reason as Error).message); }
		}
		void load(); const id = window.setInterval(() => void load(), POLL_MS);
		return () => { cancelled = true; window.clearInterval(id); };
	}, [getToken, selectedID]);

	const requests = useMemo(() => timeline?.entries.flatMap((entry) => entry.kind === "request" ? [entry.request] : []) ?? [], [timeline]);
	const events = useMemo(() => timeline?.entries.flatMap((entry) => entry.kind === "event" ? [entry.event] : []) ?? [], [timeline]);
	const compactedEvents = useMemo(() => compactObserverEvents(events, showTechnicalEvents), [events, showTechnicalEvents]);
	const groupedFindings = useMemo(() => findingGroups(findings), [findings]);
	const primaryFindings = useMemo(() => groupedFindings.filter((finding) => !isContextFinding(finding)), [groupedFindings]);
	const contextFindings = useMemo(() => groupedFindings.filter(isContextFinding), [groupedFindings]);
	const detail = requests.find((request) => request.request_id === selectedRequest) ?? null;
	const hasObservedImpact = timeline != null && (timeline.summary.error_count > 0 || timeline.summary.rebuffer_count > 0 || primaryFindings.length > 0);

	async function exportSession() {
		if (!selectedID) return;
		const token = await getToken(); if (token) await exportPlaybackSession(token, selectedID);
	}

	return <section className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-black/15">
		<div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
			<div><h2 className="font-semibold text-white">Playback Inspector</h2><p className="mt-1 text-sm text-stone-400">CMCD, delivery timings, StreamMock interventions and Observer events on one clock.</p></div>
			<div className="flex gap-2">
				<select value={selectedID} onChange={(event) => { setSelectedID(event.target.value); setSelectedRequest(null); }} className="max-w-xs rounded-xl border border-white/10 bg-[#191817] px-3 py-2 text-xs text-stone-200">
					{sessions.length === 0 && <option value="">No sessions yet</option>}
					{sessions.map(({ session }) => <option key={session.id} value={session.id}>{new Date(session.started_at_ms).toLocaleTimeString()} · {session.cmcd_session_id.slice(0, 8)} · {session.observer_connected ? "CMCD + Observer" : "CMCD only"}</option>)}
				</select>
				<button type="button" disabled={!selectedID} onClick={() => void exportSession()} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-stone-200 disabled:opacity-40">Export JSON</button>
			</div>
		</div>
		{error && <p className="m-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
		{!timeline ? <div className="px-6 py-16 text-center text-sm text-stone-400">Open the player preview to create a correlated session.</div> : <div className="space-y-8 px-5 py-6 sm:px-7">
			<div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-white/8 px-3 py-1.5 font-mono">sid {timeline.session.cmcd_session_id}</span>{timeline.session.content_id && <span className="rounded-full bg-white/8 px-3 py-1.5 font-mono">cid {timeline.session.content_id}</span>}<span className="rounded-full bg-white/8 px-3 py-1.5">preset {timeline.session.initial_preset}</span><span className={`rounded-full px-3 py-1.5 ${timeline.session.observer_connected ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>{timeline.session.observer_connected ? "Observer connected" : "CMCD only"}</span></div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
				<SummaryCard label="Startup" value={formatMS(timeline.summary.startup_time_ms)} hint={timeline.summary.startup_method ?? "Observer needed"} />
				<SummaryCard label="Rebuffers" value={`${timeline.summary.rebuffer_count}`} hint={formatMS(timeline.summary.rebuffer_duration_ms)} />
				<SummaryCard label="Requests" value={`${timeline.summary.request_count}`} hint={`${timeline.summary.error_count} errors`} />
				<SummaryCard label="Bytes" value={`${(timeline.summary.bytes / 1_000_000).toFixed(2)} MB`} hint={`${timeline.summary.intervention_count} interventions`} />
				<SummaryCard label="Bitrate avg" value={formatKbps(timeline.summary.average_bitrate_kbps)} hint={`${formatKbps(timeline.summary.minimum_bitrate_kbps)}–${formatKbps(timeline.summary.maximum_bitrate_kbps)}`} />
				<SummaryCard label="Deadline misses" value={`${timeline.summary.deadline_miss_count}`} hint={`${timeline.summary.starvation_count} starvation`} />
			</div>

			<div><h3 className="text-sm font-semibold text-white">Request signals</h3><div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-black/15 p-4">
				<MetricLane label="Buffer" unit="ms" requests={requests} value={(request) => request.cmcd?.bl_ms} />
				<MetricLane label="Bitrate" unit="kbps" requests={requests} value={(request) => request.cmcd?.br_kbps} />
				<MetricLane label="Player mtp" unit="kbps" requests={requests} value={(request) => request.cmcd?.mtp_kbps} />
				<MetricLane label="Proxy delivery" unit="kbps" requests={requests} value={(request) => request.effective_delivery_kbps} />
			</div></div>

			<div className="grid gap-6 lg:grid-cols-2">
				<div><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{hasObservedImpact ? "Why did playback degrade?" : "Playback diagnosis"}</h3><p className="mt-1 text-xs text-stone-500">{hasObservedImpact ? "Causas agrupadas por regra; cada cartão representa um padrão, não um request." : "Nenhuma regra conhecida detectou degradação observada nesta sessão."}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium ${hasObservedImpact ? "bg-amber-400/15 text-amber-200" : "bg-emerald-400/15 text-emerald-200"}`}>{hasObservedImpact ? "Impact detected" : "No degradation detected"}</span></div><div className="mt-3 space-y-2">{primaryFindings.length === 0 ? <p className="rounded-xl border border-emerald-300/15 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">Playback appears healthy for the signals currently available. This is not a guarantee beyond the observed data.</p> : primaryFindings.map((finding) => <FindingCard key={`${finding.rule_id}-${finding.rule_version}`} finding={finding} onRequest={setSelectedRequest} />)}</div>{contextFindings.length > 0 && <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"><summary className="cursor-pointer text-[11px] text-stone-400">Context signals ({contextFindings.length})</summary><div className="mt-2 space-y-2">{contextFindings.map((finding) => <FindingCard key={`${finding.rule_id}-${finding.rule_version}`} finding={finding} onRequest={setSelectedRequest} compact />)}</div></details>}</div>
				<div><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">Observer events</h3><p className="mt-1 text-xs text-stone-500">Ciclos de fragmento agrupados; sinais técnicos repetitivos ficam recolhidos.</p></div><button type="button" onClick={() => setShowTechnicalEvents((current) => !current)} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] text-stone-300">{showTechnicalEvents ? "Hide technical" : "Show technical"}</button></div><div className="mt-3 max-h-80 space-y-1 overflow-auto rounded-2xl border border-white/10 p-3">{events.length === 0 ? <p className="p-3 text-xs text-stone-500">Observer not connected or no events ingested.</p> : <>{compactedEvents.visible.slice(-100).map((event) => <div key={`${event.id}-${event.event_type}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs"><span className="text-stone-200">{eventLabel(event)}{event.count && event.count > 1 ? ` ×${event.count}` : ""}</span><span className="shrink-0 font-mono text-stone-500">+{formatMS(event.wall_time_ms - timeline.session.started_at_ms)} · buffer {formatMS(event.buffer_ahead_ms)}</span></div>)}{compactedEvents.hidden > 0 && <p className="px-3 py-2 text-[10px] text-stone-500">{compactedEvents.hidden} technical signals collapsed.</p>}</>}</div></div>
			</div>

			<div><h3 className="text-sm font-semibold text-white">Delivery waterfall</h3><div className="mt-3 space-y-2">{requests.map((request) => <WaterfallRow key={request.request_id} request={request} maxDuration={Math.max(1, ...requests.map((item) => item.duration_ms))} selected={selectedRequest === request.request_id} onSelect={() => setSelectedRequest(request.request_id)} />)}</div></div>
			{detail && <RequestDetail request={detail} />}
		</div>}
	</section>;
}

function FindingCard({ finding, onRequest, compact = false }: { finding: Finding; onRequest: (requestID: number) => void; compact?: boolean }) {
	return <button type="button" onClick={() => { const request = finding.evidence?.find((item) => item.kind === "request"); if (request) onRequest(Number(request.id)); }} className={`block w-full rounded-xl border ${compact ? "px-3 py-2" : "px-4 py-3"} text-left ${severityClass(finding.severity)}`}>
		<div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-wider">{finding.rule_id} · {finding.confidence} confidence</span><span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px]">{finding.occurrences ?? 1} request{(finding.occurrences ?? 1) === 1 ? "" : "s"}</span></div>
		<p className="mt-1 text-xs leading-5">{finding.message}</p>
		{(finding.evidence?.length ?? 0) > 1 && <p className="mt-2 text-[10px] text-white/50">Evidence: {finding.evidence?.filter((item) => item.kind === "request").map((item) => `#${item.id}`).join(", ")}</p>}
	</button>;
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p><p className="mt-2 text-xl font-semibold text-white">{value}</p><p className="mt-1 truncate text-[10px] text-stone-500">{hint}</p></div>; }

function MetricLane({ label, unit, requests, value }: { label: string; unit: string; requests: RequestPoint[]; value: (request: RequestPoint) => number | undefined }) {
	const max = Math.max(1, ...requests.map((request) => value(request) ?? 0));
	return <div className="grid grid-cols-[7rem_1fr] items-center gap-3"><span className="text-[11px] text-stone-400">{label}</span><div className="flex h-7 items-end gap-1">{requests.map((request) => { const metric = value(request); return <div key={request.request_id} title={`${metric ?? "unknown"} ${unit}`} className={`min-w-1 flex-1 rounded-sm ${metric == null ? "h-1 bg-white/10" : request.deadline_miss_ms != null ? "bg-red-400/70" : "bg-sky-400/65"}`} style={metric == null ? undefined : { height: `${Math.max(8, metric / max * 100)}%` }} />; })}</div></div>;
}

function WaterfallRow({ request, maxDuration, selected, onSelect }: { request: RequestPoint; maxDuration: number; selected: boolean; onSelect: () => void }) {
	const phases = [{ value: request.dns_ms, color: "bg-violet-400", label: "DNS" }, { value: request.connect_ms, color: "bg-sky-400", label: "TCP" }, { value: request.tls_ms, color: "bg-cyan-300", label: "TLS" }, { value: request.ttfb_ms, color: "bg-amber-400", label: "TTFB" }, { value: request.relay_ms ?? request.local_serve_ms, color: request.local_serve_ms != null ? "bg-emerald-300" : "bg-emerald-500", label: request.local_serve_ms != null ? "local" : "relay" }];
	return <button type="button" onClick={onSelect} className={`grid w-full grid-cols-[5rem_1fr_5rem] items-center gap-3 rounded-xl border px-3 py-2 text-left ${selected ? "border-sky-300/40 bg-sky-400/5" : "border-white/10 bg-white/[0.02]"}`}><span className="text-[10px] text-stone-400">#{request.request_id} {request.kind}</span><span className="flex h-3 overflow-hidden rounded-full bg-white/5" style={{ width: `${Math.max(8, request.duration_ms / maxDuration * 100)}%` }}>{phases.map((phase) => phase.value == null ? null : <span key={phase.label} title={`${phase.label}: ${phase.value} ms`} className={phase.color} style={{ width: `${Math.max(2, phase.value / Math.max(1, request.duration_ms) * 100)}%` }} />)}</span><span className="text-right font-mono text-[10px] text-stone-500">{formatMS(request.duration_ms)}</span></button>;
}

function RequestDetail({ request }: { request: RequestPoint }) { return <div className="rounded-2xl border border-sky-300/20 bg-sky-400/5 p-5"><h3 className="text-sm font-semibold text-white">Request #{request.request_id}</h3><p className="mt-2 break-all font-mono text-xs text-stone-400">{request.target_url}</p><div className="mt-4 grid gap-3 sm:grid-cols-4"><SummaryCard label="CMCD" value={request.cmcd ? request.cmcd.valid ? "valid" : "invalid" : "absent"} hint={request.cmcd?.canonical_value ?? "No CMCD payload"} /><SummaryCard label="Deadline" value={formatMS(request.cmcd?.dl_ms)} hint={request.deadline_miss_ms != null ? `missed by ${formatMS(request.deadline_miss_ms)}` : "not missed / unknown"} /><SummaryCard label="Origin body" value={formatMS(request.origin_body_ms)} hint="time blocked on upstream reads" /><SummaryCard label="Delivery" value={formatKbps(request.effective_delivery_kbps)} hint={`total ${formatMS(request.duration_ms)}`} /></div><pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-black/30 p-4 text-[11px] text-stone-300">{JSON.stringify(request, null, 2)}</pre></div>; }
