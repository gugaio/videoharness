import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError, getPlaybackTimeline, listPlaybackSessions } from "../api";
import type { Finding, PlaybackEvent, RequestPoint } from "../api";
import { WaterfallTrack } from "./WaterfallTrack";

const hiddenObserverTypes = new Set(["media_snapshot", "visibility_changed", "buffer_appended", "fragment_parsed"]);
const fragmentLifecycleTypes = new Set(["fragment_loading", "fragment_loaded", "fragment_parsed", "fragment_buffered"]);

interface DisplayEvent extends PlaybackEvent {
  count?: number;
  stages?: string[];
}

function formatMS(value?: number): string {
  return value == null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function formatKbps(value?: number): string {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} kbps`;
}

function severityClass(value: Finding["severity"]): string {
  if (value === "error") return "pb-finding pb-finding-error";
  if (value === "warning") return "pb-finding pb-finding-warning";
  return "pb-finding pb-finding-info";
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
      const lifecycle: DisplayEvent = {
        ...event,
        event_type: "fragment_lifecycle",
        stages: [event.event_type.replace("fragment_", "")],
      };
      fragments.set(key, lifecycle);
      visible.push(lifecycle);
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
  return (
    finding.rule_id === "urgent_request" ||
    finding.rule_id === "throughput_perception_divergence" ||
    (finding.rule_id === "buffer_exhaustion_risk" && finding.confidence !== "high") ||
    (finding.rule_id === "bitrate_above_throughput" && finding.confidence !== "high") ||
    (finding.rule_id === "deadline_miss" && finding.confidence !== "high") ||
    finding.rule_id === "invalid_cmcd"
  );
}

export function PlaybackInspector({
  streamId,
  source,
  preset,
}: {
  streamId?: string;
  source?: string;
  preset?: string;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const sessions = useQuery({
    queryKey: ["playback-sessions", streamId ?? "", source ?? "", preset ?? ""],
    queryFn: () =>
      listPlaybackSessions({
        ...(streamId ? { streamId } : {}),
        ...(source ? { source } : {}),
        ...(preset ? { preset } : {}),
      }),
    refetchInterval: 4_000,
  });

  const items = sessions.data?.sessions ?? [];
  const activeId = selectedId && items.some((item) => item.session.id === selectedId)
    ? selectedId
    : (items[0]?.session.id ?? "");

  const timeline = useQuery({
    queryKey: ["playback-timeline", activeId],
    queryFn: () => getPlaybackTimeline(activeId),
    enabled: Boolean(activeId),
    refetchInterval: 4_000,
  });

  const data = timeline.data;
  const requests = useMemo(
    () => data?.timeline.entries.flatMap((entry) => (entry.kind === "request" ? [entry.request] : [])) ?? [],
    [data],
  );
  const events = useMemo(
    () => data?.timeline.entries.flatMap((entry) => (entry.kind === "event" ? [entry.event] : [])) ?? [],
    [data],
  );
  const compacted = useMemo(() => compactObserverEvents(events, showTechnical), [events, showTechnical]);
  const grouped = useMemo(() => findingGroups(data?.findings ?? []), [data]);
  const primary = grouped.filter((finding) => !isContextFinding(finding));
  const context = grouped.filter(isContextFinding);
  const detail = requests.find((request) => request.request_id === selectedRequest) ?? null;
  const hasImpact =
    data != null &&
    (data.timeline.summary.error_count > 0 || data.timeline.summary.rebuffer_count > 0 || primary.length > 0);

  const error = timeline.isError
    ? timeline.error instanceof ApiError
      ? timeline.error.message
      : "erro desconhecido"
    : sessions.isError
      ? sessions.error instanceof ApiError
        ? sessions.error.message
        : "erro desconhecido"
      : null;

  function exportSession() {
    if (!data) return;
    const payload = {
      schema_version: 1,
      exported_at_ms: Date.now(),
      timeline: data.timeline,
      findings: data.findings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `video-harness-playback-${data.timeline.session.id}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  return (
    <section className="pb-inspector" aria-label="Playback Inspector">
      <header className="pb-inspector-head">
        <div>
          <h3>Playback Inspector</h3>
          <p className="panel-hint">
            CMCD, timings de entrega, intervenções do StreamMock e eventos do
            observer no mesmo relógio.
          </p>
        </div>
        <div className="pb-inspector-actions">
          <select
            value={activeId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setSelectedRequest(null);
            }}
            aria-label="Sessão de playback"
          >
            {items.length === 0 && <option value="">Nenhuma sessão ainda</option>}
            {items.map(({ session }) => (
              <option key={session.id} value={session.id}>
                {new Date(session.started_at_ms).toLocaleTimeString()} ·{" "}
                {session.cmcd_session_id.slice(0, 8)} · {session.observer_connected ? "CMCD + Observer" : "CMCD"}
              </option>
            ))}
          </select>
          <button type="button" className="streams-button" disabled={!data} onClick={exportSession}>
            Exportar JSON
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="state-error">
          {error}
        </p>
      )}
      {timeline.isPending && activeId && <p className="state">Carregando timeline…</p>}
      {!activeId && (
        <div className="pb-empty">
          <p>Nenhuma sessão de playback ainda</p>
          <p className="panel-hint">Abra o player acima para criar uma sessão correlacionada.</p>
        </div>
      )}

      {data && (
        <div className="pb-body">
          <div className="pb-chips">
            <span className="pb-chip pb-chip-mono">sid {data.timeline.session.cmcd_session_id}</span>
            {data.timeline.session.content_id && (
              <span className="pb-chip pb-chip-mono">cid {data.timeline.session.content_id}</span>
            )}
            <span className="pb-chip">preset {data.timeline.session.initial_preset}</span>
            <span className={`pb-chip ${data.timeline.session.observer_connected ? "pb-chip-ok" : "pb-chip-warn"}`}>
              {data.timeline.session.observer_connected ? "Observer conectado" : "Só CMCD"}
            </span>
          </div>

          <div className="pb-summary">
            <SummaryCard label="Startup" value={formatMS(data.timeline.summary.startup_time_ms)} hint={data.timeline.summary.startup_method ?? "Requer observer"} />
            <SummaryCard label="Rebuffers" value={`${data.timeline.summary.rebuffer_count}`} hint={formatMS(data.timeline.summary.rebuffer_duration_ms)} />
            <SummaryCard label="Requests" value={`${data.timeline.summary.request_count}`} hint={`${data.timeline.summary.error_count} erros`} />
            <SummaryCard label="Bytes" value={`${(data.timeline.summary.bytes / 1_000_000).toFixed(2)} MB`} hint={`${data.timeline.summary.intervention_count} intervenções`} />
            <SummaryCard label="Bitrate avg" value={formatKbps(data.timeline.summary.average_bitrate_kbps)} hint={`${formatKbps(data.timeline.summary.minimum_bitrate_kbps)}–${formatKbps(data.timeline.summary.maximum_bitrate_kbps)}`} />
            <SummaryCard label="Deadline misses" value={`${data.timeline.summary.deadline_miss_count}`} hint={`${data.timeline.summary.starvation_count} starvation`} />
          </div>

          <div>
            <h4 className="pb-subtitle">Sinais por request</h4>
            <CombinedThroughputChart requests={requests} />
            <div className="pb-lanes">
              <MetricLane label="Buffer" unit="ms" requests={requests} value={(request) => request.cmcd?.bl_ms} />
            </div>
          </div>

          <div className="pb-columns">
            <div>
              <div className="pb-subhead">
                <h4 className="pb-subtitle">{hasImpact ? "Por que degradou?" : "Diagnóstico"}</h4>
                <span className={`pb-chip ${hasImpact ? "pb-chip-warn" : "pb-chip-ok"}`}>
                  {hasImpact ? "Impacto detectado" : "Sem degradação"}
                </span>
              </div>
              {primary.length === 0 ? (
                <p className="pb-healthy">
                  Playback saudável para os sinais disponíveis. Não é garantia além dos dados observados.
                </p>
              ) : (
                primary.map((finding) => (
                  <FindingCard key={`${finding.rule_id}-${finding.rule_version}`} finding={finding} onRequest={setSelectedRequest} />
                ))
              )}
              {context.length > 0 && (
                <details className="pb-context">
                  <summary>Sinais de contexto ({context.length})</summary>
                  {context.map((finding) => (
                    <FindingCard key={`${finding.rule_id}-${finding.rule_version}`} finding={finding} onRequest={setSelectedRequest} compact />
                  ))}
                </details>
              )}
            </div>

            <div>
              <div className="pb-subhead">
                <h4 className="pb-subtitle">Eventos do observer</h4>
                <button type="button" className="streams-button" onClick={() => setShowTechnical((value) => !value)}>
                  {showTechnical ? "Ocultar técnicos" : "Mostrar técnicos"}
                </button>
              </div>
              <div className="pb-events">
                {events.length === 0 ? (
                  <p className="panel-hint">Observer não conectado ou sem eventos ingeridos.</p>
                ) : (
                  <>
                    {compacted.visible.slice(-100).map((event) => (
                      <div key={`${event.id}-${event.event_type}`} className="pb-event">
                        <span>
                          {eventLabel(event)}
                          {event.count && event.count > 1 ? ` ×${event.count}` : ""}
                        </span>
                        <span className="pb-event-time">
                          +{formatMS(event.wall_time_ms - data.timeline.session.started_at_ms)} · buffer{" "}
                          {formatMS(event.buffer_ahead_ms)}
                        </span>
                      </div>
                    ))}
                    {compacted.hidden > 0 && (
                      <p className="panel-hint">{compacted.hidden} sinais técnicos recolhidos.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <h4 className="pb-subtitle">Waterfall de entrega</h4>
            <p className="panel-hint">
              Cada linha é um request HTTP da sessão, em ordem temporal. O ID é o request registrado no StreamMock.
            </p>
            <div className="pb-waterfall">
              {requests.map((request) => (
                <WaterfallRow
                  key={request.request_id}
                  request={request}
                  maxDuration={Math.max(1, ...requests.map((item) => item.duration_ms))}
                  selected={selectedRequest === request.request_id}
                  onSelect={() => setSelectedRequest(request.request_id)}
                />
              ))}
            </div>
          </div>

          {detail && <RequestDetail request={detail} />}
        </div>
      )}
    </section>
  );
}

function FindingCard({
  finding,
  onRequest,
  compact = false,
}: {
  finding: Finding;
  onRequest: (requestId: number) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${severityClass(finding.severity)} ${compact ? "pb-finding-compact" : ""}`}
      onClick={() => {
        const request = finding.evidence?.find((item) => item.kind === "request");
        if (request) onRequest(Number(request.id));
      }}
    >
      <div className="pb-finding-head">
        <span>
          {finding.rule_id} · {finding.confidence}
        </span>
        <span className="pb-finding-count">
          {finding.occurrences ?? 1} request{(finding.occurrences ?? 1) === 1 ? "" : "s"}
        </span>
      </div>
      <p>{finding.message}</p>
      {(finding.evidence?.length ?? 0) > 1 && (
        <p className="pb-finding-evidence">
          Evidência:{" "}
          {finding.evidence
            ?.filter((item) => item.kind === "request")
            .map((item) => `#${item.id}`)
            .join(", ")}
        </p>
      )}
    </button>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="pb-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function MetricLane({
  label,
  unit,
  requests,
  value,
}: {
  label: string;
  unit: string;
  requests: RequestPoint[];
  value: (request: RequestPoint) => number | undefined;
}) {
  const max = Math.max(1, ...requests.map((request) => value(request) ?? 0));
  return (
    <div className="pb-lane">
      <span className="pb-lane-label">{label}</span>
      <div className="pb-lane-bars">
        {requests.map((request) => {
          const metric = value(request);
          return (
            <div
              key={request.request_id}
              title={`${metric ?? "desconhecido"} ${unit}`}
              className={`pb-bar ${metric == null ? "pb-bar-empty" : request.deadline_miss_ms != null ? "pb-bar-miss" : ""}`}
              style={metric == null ? undefined : { height: `${Math.max(8, (metric / max) * 100)}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ThroughputSeries {
  key: string;
  label: string;
  color: string;
  value: (request: RequestPoint) => number | undefined;
}

const throughputSeries: ThroughputSeries[] = [
  { key: "bitrate", label: "Bitrate", color: "#2563eb", value: (request) => request.cmcd?.br_kbps },
  { key: "mtp", label: "Player mtp", color: "#7c3aed", value: (request) => request.cmcd?.mtp_kbps },
  { key: "delivery", label: "Entrega proxy", color: "#059669", value: (request) => request.effective_delivery_kbps },
];

const logFloorKbps = 100;

function fmtThroughput(value: number): string {
  const trim = (v: number) => v.toFixed(v < 10 ? 1 : 0);
  if (value >= 1_000_000) return `${trim(value / 1_000_000)} Gbps`;
  if (value >= 1_000) return `${trim(value / 1_000)} Mbps`;
  return `${value} kbps`;
}

function barHeightPct(metric: number, max: number, log: boolean): number {
  if (!log) return Math.max(4, (metric / max) * 100);
  const top = Math.log10(Math.max(max, logFloorKbps * 10));
  const value = Math.log10(Math.max(metric, logFloorKbps));
  return Math.max(4, ((value - Math.log10(logFloorKbps)) / (top - Math.log10(logFloorKbps))) * 100);
}

function CombinedThroughputChart({ requests }: { requests: RequestPoint[] }) {
  const [logScale, setLogScale] = useState(true);
  const max = Math.max(
    1,
    ...requests.flatMap((request) => throughputSeries.map((series) => series.value(request) ?? 0)),
  );
  const decades: number[] = [];
  if (logScale) {
    for (let value = logFloorKbps; value <= max; value *= 10) decades.push(value);
  }
  return (
    <div className="pb-chart" role="img" aria-label={`Throughput por request: bitrate, mtp do player e entrega do proxy, em kbps, escala ${logScale ? "logarítmica" : "linear"}`}>
      <div className="pb-chart-head">
        <div className="pb-chart-legend">
          {throughputSeries.map((series) => (
            <span key={series.key} className="pb-chart-legend-item">
              <span className="pb-chart-swatch" style={{ background: series.color }} />
              {series.label} (kbps)
            </span>
          ))}
        </div>
        <button type="button" className="streams-button pb-chart-toggle" onClick={() => setLogScale((value) => !value)}>
          {logScale ? "Log" : "Linear"}
        </button>
      </div>
      <div className="pb-chart-plotwrap">
        {logScale && decades.length > 1 && (
          <div className="pb-chart-grid" aria-hidden="true">
            {decades.map((value) => (
              <div
                key={value}
                className="pb-chart-gridline"
                style={{ bottom: `${((Math.log10(value) - Math.log10(logFloorKbps)) / (Math.log10(Math.max(max, logFloorKbps * 10)) - Math.log10(logFloorKbps))) * 100}%` }}
              >
                <span>{fmtThroughput(value)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pb-chart-plot">
          {requests.map((request) => {
            const values = throughputSeries.map((series) => series.value(request));
            const summary = throughputSeries
              .map((series, index) => {
                const metric = values[index];
                return `${series.label} ${metric == null ? "—" : Math.round(metric).toLocaleString()}`;
              })
              .join(" · ");
            const missed = request.deadline_miss_ms != null;
            return (
              <div
                key={request.request_id}
                className={`pb-chart-col ${missed ? "pb-chart-col-miss" : ""}`}
                title={`#${request.request_id} · ${summary} kbps${missed ? " · deadline perdido" : ""}`}
              >
                {throughputSeries.map((series, index) => {
                  const metric = values[index];
                  return metric == null ? (
                    <span key={series.key} className="pb-chart-bar pb-chart-bar-empty" style={{ height: "4%" }} />
                  ) : (
                    <span
                      key={series.key}
                      className="pb-chart-bar"
                      style={{
                        height: `${barHeightPct(metric, max, logScale)}%`,
                        background: `${series.color}4d`,
                        borderTopColor: series.color,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {logScale && (
        <p className="pb-chart-note">Escala logarítmica — em localhost a entrega supera o bitrate por ordens de magnitude.</p>
      )}
    </div>
  );
}

function WaterfallRow({
  request,
  maxDuration,
  selected,
  onSelect,
}: {
  request: RequestPoint;
  maxDuration: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const failed =
    request.status >= 400 || (request.injected_status ?? 0) >= 400 || request.transport_error != null;
  const effectiveStatus = request.injected_status ?? request.status;
  return (
    <button
      type="button"
      className={`pb-waterfall-row ${selected ? "pb-waterfall-selected" : ""} ${failed ? "pb-waterfall-error" : ""}`}
      title={`Request #${request.request_id} · HTTP ${effectiveStatus}${request.transport_error ? ` · ${request.transport_error}` : ""}`}
      onClick={onSelect}
    >
      <span className="pb-waterfall-id">
        Request #{request.request_id} · {request.kind}
        {failed && <span className="pb-waterfall-status"> · HTTP {effectiveStatus}</span>}
      </span>
      <WaterfallTrack request={request} maxDuration={maxDuration} />
      <span className="pb-waterfall-duration">{formatMS(request.duration_ms)}</span>
    </button>
  );
}

function RequestDetail({ request }: { request: RequestPoint }) {
  return (
    <div className="pb-request-detail">
      <h4>Request #{request.request_id}</h4>
      <p className="pb-request-url">{request.target_url}</p>
      <div className="pb-request-grid">
        <SummaryCard label="CMCD" value={request.cmcd ? (request.cmcd.valid ? "válido" : "inválido") : "ausente"} hint={request.cmcd?.canonical_value ?? "Sem payload CMCD"} />
        <SummaryCard label="Deadline" value={formatMS(request.cmcd?.dl_ms)} hint={request.deadline_miss_ms != null ? `perdido por ${formatMS(request.deadline_miss_ms)}` : "não perdido / desconhecido"} />
        <SummaryCard label="Origin body" value={formatMS(request.origin_body_ms)} hint="tempo bloqueado na origem" />
        <SummaryCard label="Entrega" value={formatKbps(request.effective_delivery_kbps)} hint={`total ${formatMS(request.duration_ms)}`} />
      </div>
      <pre className="pb-request-json">{JSON.stringify(request, null, 2)}</pre>
    </div>
  );
}
