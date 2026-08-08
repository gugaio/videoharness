import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ABR_PRESET_PROFILE,
  CONTROL_1080P_PROFILE,
  NORMAL_PLAYBACK_PROFILE,
  RecordingEventSchema,
  createRecordingPlaybackRun,
  getRecording,
  getRecordingRequests,
  startRecording,
  type DeliveryRequest,
  type NetworkProfileStage,
  type PlaybackRun,
  type RecordingEvent,
} from "../lib/api";
import { formatBytes, shortId } from "../lib/format";

type RecordingState = "queued" | "validating" | "collecting" | "ready" | "failed";
type PlaybackMode = "normal" | "force-abr" | "control-1080p";

const STATE_META: Record<RecordingState, { label: string; chip: string; dot: string }> = {
  queued: { label: "Queued", chip: "border-white/15 bg-white/[0.06] text-white/70", dot: "bg-slate-300" },
  validating: { label: "Validating", chip: "border-sky-300/25 bg-sky-300/10 text-sky-200", dot: "bg-sky-400" },
  collecting: { label: "Collecting", chip: "border-amber-300/25 bg-amber-300/10 text-amber-200", dot: "bg-amber-400" },
  ready: { label: "Ready", chip: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200", dot: "bg-emerald-400" },
  failed: { label: "Failed", chip: "border-rose-300/25 bg-rose-300/10 text-rose-200", dot: "bg-rose-400" },
};

export function RecordIntakePage(): JSX.Element {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [protocol, setProtocol] = useState<"hls" | "dash">("hls");
  const [durationSeconds, setDurationSeconds] = useState(120);
  const recording = useMutation({
    mutationFn: () => startRecording({ url, protocol, durationSeconds, startSeconds: 0 }),
    onSuccess: ({ recording: created }) => navigate(`/recordings/${created.id}`),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (url.trim() && !recording.isPending) recording.mutate();
  }

  return (
    <Shell>
      <section className="mx-auto mt-16 w-full max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[.25em] text-sky-200/70">VOD ABR laboratory</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Record a stream for an ABR test.</h1>
        <p className="mt-4 text-harness-muted">Clones a supported VOD ladder locally. HLS supports clear MPEG-TS; DASH supports static clear fMP4 with SegmentTemplate. Live, DRM and byte ranges are rejected before publishing.</p>
        <form className="mt-9 space-y-5" onSubmit={submit}>
          <input
            className="h-14 w-full rounded-2xl border border-white/15 bg-black/25 px-5 font-mono text-sm outline-none transition focus:border-sky-300/50 focus:ring-1 focus:ring-sky-300/20"
            onChange={(event) => setUrl(event.target.value)}
            placeholder={protocol === "hls" ? "https://example.com/vod/master.m3u8" : "https://example.com/vod/manifest.mpd"}
            type="url"
            value={url}
          />
          <label className="block text-sm text-white/70">
            Protocol
            <select className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#11131b] px-4 outline-none transition focus:border-sky-300/50 focus:ring-1 focus:ring-sky-300/20" onChange={(event) => setProtocol(event.target.value as "hls" | "dash")} value={protocol}>
              <option value="hls">HLS VOD · clear MPEG-TS</option>
              <option value="dash">DASH VOD · static fMP4</option>
            </select>
          </label>
          <label className="block text-sm text-white/70">
            Window duration <span className="text-white/35">30–600 seconds</span>
            <input
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 outline-none transition focus:border-sky-300/50 focus:ring-1 focus:ring-sky-300/20"
              max={600}
              min={30}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              type="number"
              value={durationSeconds}
            />
          </label>
          <button
            className="h-14 w-full rounded-2xl bg-gradient-to-r from-sky-300 via-violet-300 to-fuchsia-300 font-semibold text-[#0a0c12] transition hover:brightness-105 disabled:opacity-40"
            disabled={!url.trim() || recording.isPending}
            type="submit"
          >
            {recording.isPending ? "Queueing recording…" : "Record stream"}
          </button>
          {recording.error && <p className="text-sm text-rose-300">{recording.error.message}</p>}
        </form>
      </section>
    </Shell>
  );
}

export function RecordingPage(): JSX.Element {
  const { recordingId = "" } = useParams();
  const client = useQueryClient();
  const [events, setEvents] = useState<RecordingEvent[]>([]);
  const [playback, setPlayback] = useState<PlaybackRun>();
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [copied, setCopied] = useState(false);

  const recording = useQuery({
    queryKey: ["recording", recordingId],
    queryFn: () => getRecording(recordingId),
    enabled: Boolean(recordingId),
    refetchInterval: (query) => (["ready", "failed"].includes(query.state.data?.state ?? "") ? false : 2_000),
  });
  const run = useMutation({
    mutationFn: (mode: PlaybackMode) => createRecordingPlaybackRun(recordingId, mode === "normal" ? NORMAL_PLAYBACK_PROFILE : mode === "control-1080p" ? CONTROL_1080P_PROFILE : ABR_PRESET_PROFILE),
    onSuccess: ({ playbackUrl: url, run: created }) => {
      setPlayback(created);
      setPlaybackUrl(new URL(url, window.location.origin).toString());
    },
  });
  const requests = useQuery({
    queryKey: ["recording-requests", recordingId, playback?.id],
    queryFn: () => getRecordingRequests(recordingId, playback!.id),
    enabled: Boolean(playback?.id),
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (!recordingId) return;
    const source = new EventSource(`/v1/recordings/${encodeURIComponent(recordingId)}/events`);
    source.addEventListener("recording.event", (raw) => {
      try {
        const parsed = RecordingEventSchema.safeParse(JSON.parse((raw as MessageEvent<string>).data));
        if (!parsed.success) return;
        setEvents((current) => (current.some((event) => event.id === parsed.data.id) ? current : [...current, parsed.data]));
        void client.invalidateQueries({ queryKey: ["recording", recordingId] });
      } catch {
        // Persisted events remain available on reconnect.
      }
    });
    return () => source.close();
  }, [recordingId, client]);

  if (recording.isLoading) return <Shell><p className="mt-24 text-center text-sm text-harness-muted">Opening recording…</p></Shell>;
  if (recording.error) return <Shell><p className="mt-24 text-center text-rose-300">{recording.error.message}</p></Shell>;
  if (!recording.data) return <Shell />;

  const value = recording.data;
  const meta = STATE_META[value.state];

  return (
    <Shell>
      <section className="mt-8">
        <header className="animate-fade-up flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${meta.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${value.state === "collecting" || value.state === "validating" ? "animate-pulse-dot" : ""}`} />
            {meta.label}
          </span>
          <span className="font-mono text-[11px] text-white/30">record {shortId(value.id)}</span>
          <span className="ml-auto hidden text-xs text-white/35 sm:inline">
            {value.completedAt
              ? `Finished ${new Date(value.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : `Opened ${new Date(value.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          </span>
        </header>

        <div className="mt-5 flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400/70 to-violet-500/70 font-mono text-sm font-bold text-white shadow-lg shadow-violet-500/20">
            {value.protocol === "dash" ? "D" : "H"}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Recording dashboard</h1>
            <p className="mt-0.5 truncate font-mono text-xs text-white/40">{value.sourceUrl}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <Metric label="Requested window" value={`${value.requestedDurationSeconds}s`} hint={`from ${value.requestedStartSeconds}s`} />
          <Metric label="Effective coverage" value={value.coverageSeconds ? `${value.coverageSeconds.toFixed(1)}s` : "—"} hint="validated window" />
          <Metric label="Stored" value={value.totalBytes ? formatBytes(value.totalBytes) : "—"} hint="all variants" />
          <Metric label="Protocol" value={value.protocol.toUpperCase()} hint={value.protocol === "dash" ? "static fMP4 · VOD" : "clear MPEG-TS · VOD"} />
        </div>

        {value.state === "ready" && (
          <ShapingPanel
            run={playback}
            url={playbackUrl}
            copied={copied}
            creating={run.isPending}
            protocol={value.protocol}
            error={run.error?.message}
            onStart={(mode) => run.mutate(mode)}
            onCopy={() => {
              if (!playbackUrl) return;
              void navigator.clipboard.writeText(playbackUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
          />
        )}

        {playback && <AbrDashboard run={playback} items={requests.data ?? []} />}

        {value.state === "failed" && (
          <div className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-5 text-rose-200">
            {value.errorMessage ?? "Recording failed."}
          </div>
        )}

        {events.length > 0 && <ActivityFeed events={events} />}
      </section>
    </Shell>
  );
}

function ShapingPanel(props: {
  run?: PlaybackRun;
  url?: string;
  copied: boolean;
  creating: boolean;
  protocol: "hls" | "dash";
  error?: string;
  onStart: (mode: PlaybackMode) => void;
  onCopy: () => void;
}): JSX.Element {
  const profile = props.run?.profile;
  const stages = profile?.stages ?? ABR_PRESET_PROFILE.stages;
  const isNormal = profile?.name === NORMAL_PLAYBACK_PROFILE.name;
  const is1080pControl = profile?.name === CONTROL_1080P_PROFILE.name;
  return (
    <section className="gradient-ring mt-8 overflow-hidden rounded-3xl shadow-card">
      <div className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">Playback mode</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight">{profile ? (is1080pControl ? "1080p control" : isNormal ? "Normal playback" : "Forced ABR") : "Choose how to start"}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-harness-muted">
              {profile ? (is1080pControl ? "This DASH control exposes only the highest-bitrate 1920×1080 representation and the original audio. The fixed playback URL stays the same." : isNormal ? "The device receives a generous, stable local network profile with no intentional ABR pressure." : "The device sees a constrained interval followed by recovery, so its representation requests can reveal ABR behavior.") : "Use Normal for a control playback, Force ABR to introduce a constrained interval, or 1080p control to remove video adaptation entirely."}
            </p>
          </div>
          {!props.run && (
            <div className="flex flex-wrap gap-2">
              <button className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 disabled:opacity-45" disabled={props.creating} onClick={() => props.onStart("normal")}>{props.creating ? "Creating test…" : "Start normal"}</button>
              {props.protocol === "dash" && <button className="rounded-xl border border-emerald-300/30 bg-emerald-300/[0.08] px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/60 disabled:opacity-45" disabled={props.creating} onClick={() => props.onStart("control-1080p")}>1080p control</button>}
              <button className="rounded-xl bg-gradient-to-r from-sky-200 to-violet-200 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-45" disabled={props.creating} onClick={() => props.onStart("force-abr")}>Force ABR</button>
            </div>
          )}
        </div>

        <ShapingStepper stages={stages} activeIndex={props.run ? undefined : 0} />

        {props.url && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 break-all font-mono text-xs text-sky-100">{props.url}</p>
              <button className="shrink-0 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs text-white/80 transition hover:border-white/30 hover:text-white" onClick={props.onCopy}>
                {props.copied ? "Copied" : "Copy playback URL"}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-white/40">Open this URL on the target device. The fixed endpoint now points to this run.</p>
          </div>
        )}
        {props.error && <p className="mt-4 text-sm text-rose-300">{props.error}</p>}
      </div>
    </section>
  );
}

function ShapingStepper({ stages, activeIndex }: { stages: readonly NetworkProfileStage[]; activeIndex?: number }): JSX.Element {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {stages.map((stage, index) => (
        <div key={index} className={`rounded-2xl border p-4 transition ${activeIndex === index ? "border-sky-300/40 bg-sky-300/[0.07]" : "border-white/[0.08] bg-white/[0.03]"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${activeIndex === index ? "bg-sky-300 text-slate-950" : "bg-white/10 text-white/60"}`}>{index + 1}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/45">after #{stage.afterVideoRequests} video</span>
          </div>
          <p className="mt-3 font-mono text-lg font-semibold text-white">{stage.bandwidthKbps.toLocaleString()} <span className="text-xs font-normal text-white/40">kbps</span></p>
          <p className="text-xs text-white/45">{stage.latencyMs} ms latency</p>
        </div>
      ))}
    </div>
  );
}

function AbrDashboard({ run, items }: { run: PlaybackRun; items: DeliveryRequest[] }): JSX.Element {
  const stats = useMemo(() => summarize(items), [items]);
  return (
    <section className="mt-8 space-y-4">
      <div className="animate-fade-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">Live playback run</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">ABR evidence</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" />
          {stats.variantChanges > 0 ? `${stats.variantChanges} variant change${stats.variantChanges > 1 ? "s" : ""} observed` : items.length > 0 ? "collecting attempts…" : "waiting for device…"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Metric label="Requests" value={String(stats.total)} hint="all resources" />
        <Metric label="Video picks" value={String(stats.video)} hint="segment requests" />
        <Metric label="Avg latency" value={stats.avgLatency === null ? "—" : `${stats.avgLatency} ms`} hint="served" />
        <Metric label="Avg bandwidth" value={stats.avgBandwidth === null ? "—" : `${stats.avgBandwidth} kbps`} hint="network pacing" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <BandwidthChart items={items} stages={run.profile.stages} />
        </div>
        <div className="lg:col-span-2">
          <LatencyChart items={items} />
        </div>
      </div>

      {items.length > 0 && <RequestTimeline items={items} />}
    </section>
  );
}

function BandwidthChart({ items, stages }: { items: DeliveryRequest[]; stages: NetworkProfileStage[] }): JSX.Element {
  const W = 660;
  const H = 250;
  const padL = 46;
  const padR = 14;
  const padT = 20;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const shaped = items.map((item) => item.bandwidthKbps ?? 0);
  const variants = items.flatMap((item, i) =>
    item.variantBandwidth !== undefined && item.resourceKind === "video-segment" ? [{ x: i, y: item.variantBandwidth, res: item.variantResolution }] : [],
  );
  const rawMax = Math.max(1, ...shaped, ...variants.map((v) => v.y));
  const n = shaped.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const px = (index: number): number => padL + (n > 1 ? index * step : plotW / 2);
  const py = (kbps: number): number => padT + plotH - (kbps / rawMax) * plotH;

  const line = shaped.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const area = line ? `${line} L${px(n - 1).toFixed(1)} ${padT + plotH} L${px(0).toFixed(1)} ${padT + plotH} Z` : "";
  const bands = stageBands(items);

  return (
    <ChartCard title="Bandwidth vs representation" subtitle="What the network allowed vs what the player picked">
      <svg className="w-full" height={H} role="img" aria-label="Bandwidth over requests" viewBox={`0 0 ${W} ${H}`}>
        {ticks(rawMax, 4).map((tick, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={py(tick)} y2={py(tick)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={padL - 8} y={py(tick) + 3} className="fill-white/35 font-mono text-[10px]" textAnchor="end">{fmtShortKbps(tick)}</text>
          </g>
        ))}
        {bands.map((band, i) => (
          <rect key={i} x={px(band.start)} y={padT} width={Math.max(0, px(band.end + 1) - px(band.start))} height={plotH} rx={6} fill={STAGE_FILL[i % STAGE_FILL.length]} />
        ))}
        {area && <path d={area} fill="rgba(125,211,252,0.08)" />}
        {line && <path d={line} fill="none" stroke="#7dd3fc" strokeWidth={2} />}
        {variants.map((v) => (
          <circle key={v.x} cx={px(v.x)} cy={py(v.y)} r={3.5} fill="#f0abfc" stroke="#070810" strokeWidth={1.5}>
            <title>{`${v.res ?? "video"} · ${fmtKbps(v.y)}`}</title>
          </circle>
        ))}
        <defs>
          <linearGradient id="band-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(125,211,252,0.25)" />
            <stop offset="100%" stopColor="rgba(125,211,252,0.02)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/50">
        <Legend swatch="bg-sky-300" label="Shaped bandwidth" />
        <Legend swatch="bg-fuchsia-300" label="Player selection" />
        {stages.map((_, i) => (
          <Legend key={i} swatch={STAGE_COLORS[i] ?? "bg-white/30"} label={i === 0 ? "Good" : i === 1 ? "Constrained" : "Recovery"} />
        ))}
      </div>
    </ChartCard>
  );
}

function LatencyChart({ items }: { items: DeliveryRequest[] }): JSX.Element {
  const W = 380;
  const H = 250;
  const pad = 8;
  const latencies = items.map((it) => it.latencyMs ?? 0);
  const maxLat = Math.max(1, ...latencies);
  const n = latencies.length;
  const step = Math.min(16, (W - pad * 2) / Math.max(1, n));
  const barW = Math.max(2, step - 4);
  return (
    <ChartCard title="Served latency" subtitle="Per-request round-trip pacing">
      {n === 0 ? (
        <EmptyChart label="Waiting for the device to request the playlist." />
      ) : (
        <svg className="w-full" height={H} role="img" aria-label="Latency per request" viewBox={`0 0 ${W} ${H}`}>
          {latencies.map((lat, i) => {
            const barH = Math.max(2, (lat / maxLat) * (H - pad * 2));
            return (
              <rect
                key={i}
                x={pad + i * step}
                y={pad + (H - pad * 2) - barH}
                width={barW}
                height={barH}
                rx={2}
                fill={lat < 150 ? "#43d18b" : lat < 300 ? "#fbbf24" : "#fb7185"}
                opacity={0.85}
              >
                <title>{`${lat} ms${items[i]?.variantResolution ? ` · ${items[i].variantResolution}` : ""}`}</title>
              </rect>
            );
          })}
        </svg>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-white/45">
        <Legend swatch="bg-[#43d18b]" label="<150 ms" />
        <Legend swatch="bg-[#fbbf24]" label="150–300 ms" />
        <Legend swatch="bg-[#fb7185]" label=">300 ms" />
      </div>
    </ChartCard>
  );
}

function RequestTimeline({ items }: { items: DeliveryRequest[] }): JSX.Element {
  const start = new Date(items[0]!.startedAt).getTime();
  const lastId = items[items.length - 1]!.id;
  return (
    <ChartCard title="Request journal" subtitle="Requests prove representation selection, not decoded or rendered frames.">
      <ol className="space-y-2">
        {items.map((item) => {
          const relS = ((new Date(item.startedAt).getTime() - start) / 1000).toFixed(1);
          return (
            <li
              key={item.id}
              className={`flex items-center gap-3 rounded-xl border p-3 text-sm transition ${item.id === lastId ? "border-sky-300/30 bg-sky-300/[0.05]" : "border-white/[0.08] bg-white/[0.02]"}`}
            >
              <span className={`h-9 w-1 shrink-0 rounded-full ${kindColor[item.resourceKind] ?? "bg-white/20"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[11px] text-white/40">t+{relS}s</span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/45">{KIND_LABEL[item.resourceKind] ?? item.resourceKind}</span>
                  {item.variantResolution ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
                        {item.variantResolution}
                      </span>
                      {item.variantBandwidth !== undefined && <span className="font-mono text-xs text-white/45">{fmtKbps(item.variantBandwidth)}</span>}
                    </>
                  ) : (
                    item.mediaSequence !== undefined && <span className="font-mono text-xs text-white/45">seq {item.mediaSequence}</span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-white/30">{item.logicalPath}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div className="flex items-center justify-end gap-1.5 text-white/75">
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono ${STAGE_CHIP[item.stageIndex] ?? "border-white/10 bg-white/[0.05] text-white/50"}`}>S{item.stageIndex + 1}</span>
                  <span className="font-mono">{item.latencyMs} ms</span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-white/35">{formatBytes(item.bytesSent)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs leading-5 text-white/40">
        A request for another variant only proves network selection. To confirm an ABR switch you still need decode or render telemetry.
      </p>
    </ChartCard>
  );
}

function ActivityFeed({ events }: { events: RecordingEvent[] }): JSX.Element {
  return (
    <ChartCard title="Recording activity" subtitle="Persisted worker events, restored on reconnect.">
      <ol className="space-y-3">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400/70 to-violet-500/70 text-[10px] font-bold text-white">
              {event.actor?.slice(0, 1) ?? "R"}
            </span>
            <div className="min-w-0">
              <p className="text-white/85">{event.message}</p>
              <p className="mt-0.5 text-xs text-white/40">
                {event.actor} · {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-3xl border border-white/[0.08] bg-harness-panel/70 p-5 shadow-card sm:p-6">
      <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-harness-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }): JSX.Element {
  return (
    <div className="grid h-[250px] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
      <p className="max-w-xs text-center text-sm text-white/40">{label}</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="animate-fade-up rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-card sm:p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-white/35">{hint}</p>}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

function Shell({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <main className="relative min-h-screen bg-harness-bg text-harness-text">
      <AuroraBackdrop />
      <div className="relative mx-auto w-full max-w-5xl px-5 pb-24 pt-6 sm:px-8">
        <header className="flex items-center justify-between">
          <Link className="group flex items-center gap-3 text-sm font-semibold" to="/">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sky-400/80 via-violet-500/80 to-fuchsia-500/80 font-mono text-[11px] font-bold text-white shadow-lg shadow-violet-500/20 transition group-hover:brightness-110">
              V
            </span>
            <span className="hidden text-white/85 sm:inline">Video Harness Space</span>
          </Link>
        </header>
        {children}
      </div>
    </main>
  );
}

function AuroraBackdrop(): JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 animate-aurora-drift rounded-full bg-gradient-to-r from-sky-500/[0.07] via-violet-500/[0.08] to-fuchsia-500/[0.06] blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}

const STAGE_COLORS = ["bg-emerald-400", "bg-amber-400", "bg-violet-400"];
const STAGE_FILL = ["rgba(67,209,139,0.08)", "rgba(251,191,36,0.08)", "rgba(167,139,250,0.08)"];
const STAGE_CHIP = [
  "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  "border-amber-300/25 bg-amber-300/10 text-amber-200",
  "border-violet-300/25 bg-violet-300/10 text-violet-200",
];

const kindColor: Record<string, string> = {
  master: "bg-white/25",
  "media-playlist": "bg-sky-300",
  "video-segment": "bg-fuchsia-400",
  "audio-segment": "bg-violet-400",
};

const KIND_LABEL: Record<string, string> = {
  master: "master",
  "media-playlist": "playlist",
  "video-segment": "video",
  "audio-segment": "audio",
};

function ticks(max: number, count: number): number[] {
  const ticks = new Set<number>([0]);
  for (let i = 1; i < count; i += 1) ticks.add(Math.round((max * i) / count));
  return [...ticks].sort((a, b) => a - b);
}

function stageBands(items: DeliveryRequest[]): Array<{ start: number; end: number; stage: number }> {
  const bands: Array<{ start: number; end: number; stage: number }> = [];
  for (let i = 0; i < items.length; i += 1) {
    const last = bands[bands.length - 1];
    if (last && last.stage === items[i]!.stageIndex) {
      last.end = i;
    } else {
      bands.push({ start: i, end: i, stage: items[i]!.stageIndex });
    }
  }
  return bands;
}

function summarize(items: DeliveryRequest[]): { total: number; video: number; variantChanges: number; avgLatency: number | null; avgBandwidth: number | null } {
  const lats = items.map((it) => it.latencyMs ?? 0);
  const bws = items.map((it) => it.bandwidthKbps ?? 0);
  const videos = items.filter((it) => it.resourceKind === "video-segment");
  let variantChanges = 0;
  let previous = "";
  for (const v of videos) {
    const current = v.variantResolution ?? "";
    if (current && previous && current !== previous) variantChanges += 1;
    if (current) previous = current;
  }
  const avgLatency = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  const avgBandwidth = bws.length ? Math.round(bws.reduce((a, b) => a + b, 0) / bws.length) : null;
  return { total: items.length, video: videos.length, variantChanges, avgLatency, avgBandwidth };
}

function fmtShortKbps(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(0)}M` : String(kbps);
}

function fmtKbps(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}
