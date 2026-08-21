import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ABR_PRESET_PROFILE,
  NORMAL_PLAYBACK_PROFILE,
  RecordingEventSchema,
  createRecordingPlaybackRun,
  finishRecordingPlaybackRun,
  getRecording,
  getLatestRecordingPlaybackRun,
  getRecordingRequests,
  startRecording,
  type DeliveryRequest,
  type FaultPlan,
  type NetworkProfileStage,
  type PlaybackRun,
  type RecordingEvent,
} from "../lib/api";
import { formatBytes, shortId } from "../lib/format";
import { RecordingBrowserPlayer } from "../components/RecordingBrowserPlayer";

type RecordingState = "queued" | "validating" | "collecting" | "ready" | "failed";
type ResilienceScenarioId = "delay" | "http-error" | "http-404" | "truncated";
type PlaybackMode = "normal" | "force-abr" | `resilience-${ResilienceScenarioId}`;

const RESILIENCE_SCENARIO_IDS: readonly ResilienceScenarioId[] = ["delay", "http-error", "http-404", "truncated"];
const RESILIENCE_SCENARIOS: Record<ResilienceScenarioId, { title: string; description: string; faultPlan: FaultPlan }> = {
  delay: { title: "Slow manifest", description: "Delay manifest requests by 3 seconds to inspect startup and retry behavior.", faultPlan: { schemaVersion: 1, name: "Resilience · slow manifest", rules: [{ id: "slow-master", when: { resourceKind: "master" }, action: { type: "delay", delayMs: 3000 } }] } },
  "http-error": { title: "Intermittent segment 503", description: "Return 503 on every fourth video segment request.", faultPlan: { schemaVersion: 1, name: "Resilience · intermittent video 503", rules: [{ id: "video-503-every-4", when: { resourceKind: "video-segment" }, everyNthMatch: 4, action: { type: "status", statusCode: 503 } }] } },
  "http-404": { title: "Intermittent segment 404", description: "Return 404 on every fourth video segment request.", faultPlan: { schemaVersion: 1, name: "Resilience · intermittent video 404", rules: [{ id: "video-404-every-4", when: { resourceKind: "video-segment" }, everyNthMatch: 4, action: { type: "status", statusCode: 404 } }] } },
  truncated: { title: "Truncated video chunks", description: "Shorten video segment bodies to inspect parser and decode recovery.", faultPlan: { schemaVersion: 1, name: "Resilience · truncated video chunks", rules: [{ id: "truncate-video", when: { resourceKind: "video-segment" }, action: { type: "truncate_body", keepBytes: 4096 } }] } },
};

function scenarioFromParam(value: string | null): ResilienceScenarioId | undefined {
  return value && RESILIENCE_SCENARIO_IDS.includes(value as ResilienceScenarioId) ? value as ResilienceScenarioId : undefined;
}

function faultPlanForMode(mode: PlaybackMode): FaultPlan | undefined {
  return mode.startsWith("resilience-") ? RESILIENCE_SCENARIOS[mode.slice("resilience-".length) as ResilienceScenarioId].faultPlan : undefined;
}

const STATE_META: Record<RecordingState, { label: string; chip: string; dot: string }> = {
  queued: { label: "Queued", chip: "border-slate-200 text-slate-500", dot: "bg-slate-400" },
  validating: { label: "Validating", chip: "border-sky-200 text-sky-700", dot: "bg-sky-500" },
  collecting: { label: "Collecting", chip: "border-amber-200 text-amber-700", dot: "bg-amber-500" },
  ready: { label: "Ready", chip: "border-emerald-200 text-emerald-700", dot: "bg-emerald-500" },
  failed: { label: "Failed", chip: "border-rose-200 text-rose-700", dot: "bg-rose-500" },
};

export function RecordIntakePage(): JSX.Element {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [scenario, setScenario] = useState<ResilienceScenarioId | undefined>(() => scenarioFromParam(search.get("scenario")));
  const [url, setUrl] = useState(() => search.get("url") ?? "");
  const [protocol, setProtocol] = useState<"hls" | "dash">(() => {
    const fromUrl = search.get("url")?.toLowerCase() ?? "";
    return fromUrl.endsWith(".mpd") ? "dash" : "hls";
  });
  const [durationSeconds, setDurationSeconds] = useState(120);
  const recording = useMutation({
    mutationFn: () => startRecording({ url, protocol, durationSeconds, startSeconds: 0 }),
    onSuccess: ({ recording: created }) => navigate(`/recordings/${created.id}${scenario ? `?scenario=${scenario}` : ""}`),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (url.trim() && !recording.isPending) recording.mutate();
  }

  return (
    <Shell>
      <section className="mx-auto w-full max-w-2xl p-6 sm:p-8">
        <Link className="text-sm text-sky-600 hover:text-sky-700" to="/recordings">Manage local recordings</Link>
        <p className="text-xs font-medium uppercase tracking-[.25em] text-slate-400">VOD ABR laboratory</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 text-balance sm:text-5xl">Record a stream for an ABR test.</h1>
        <p className="mt-4 text-slate-500">Clones a supported VOD ladder locally. HLS supports clear MPEG-TS; DASH supports static clear fMP4 with SegmentTemplate. Live, DRM and byte ranges are rejected before publishing.</p>
        <form className="mt-9 space-y-5" onSubmit={submit}>
          <input
            className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-5 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            onChange={(event) => setUrl(event.target.value)}
            placeholder={protocol === "hls" ? "https://example.com/vod/master.m3u8" : "https://example.com/vod/manifest.mpd"}
            type="url"
            value={url}
          />
          <label className="block text-sm font-medium text-slate-700">
            Protocol
            <select className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100" onChange={(event) => setProtocol(event.target.value as "hls" | "dash")} value={protocol}>
              <option value="hls">HLS VOD · clear MPEG-TS</option>
              <option value="dash">DASH VOD · static fMP4</option>
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Resilience scenario <span className="text-slate-400">optional</span></legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button className={`rounded-xl border p-3 text-left text-sm transition ${scenario === undefined ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`} onClick={() => setScenario(undefined)} type="button">
                <span className="font-semibold">No injected faults</span><span className="mt-1 block text-xs text-slate-400">Choose Normal or Force ABR after recording.</span>
              </button>
              {RESILIENCE_SCENARIO_IDS.map((id) => {
                const item = RESILIENCE_SCENARIOS[id];
                return <button className={`rounded-xl border p-3 text-left text-sm transition ${scenario === id ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`} key={id} onClick={() => setScenario(id)} type="button"><span className="font-semibold">{item.title}</span><span className="mt-1 block text-xs text-slate-400">{item.description}</span></button>;
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">The selected scenario is applied only during the playback run and remains visible in the request journal.</p>
          </fieldset>
          <label className="block text-sm font-medium text-slate-700">
            Window duration <span className="text-slate-400">30–600 seconds</span>
            <input
              className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              max={600}
              min={30}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              type="number"
              value={durationSeconds}
            />
          </label>
          <button
            className="h-14 w-full rounded-2xl bg-violet-600 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40"
            disabled={!url.trim() || recording.isPending}
            type="submit"
          >
            {recording.isPending ? "Queueing recording…" : "Record stream"}
          </button>
          {recording.error && <p className="text-sm text-rose-600">{recording.error.message}</p>}
        </form>
      </section>
    </Shell>
  );
}

export function RecordingPage(): JSX.Element {
  const { recordingId = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<ResilienceScenarioId | undefined>(() => scenarioFromParam(search.get("scenario")));
  const client = useQueryClient();
  const [events, setEvents] = useState<RecordingEvent[]>([]);
  const [playback, setPlayback] = useState<PlaybackRun>();
  const [lastRun, setLastRun] = useState<PlaybackRun>();
  const [copied, setCopied] = useState(false);

  const recording = useQuery({
    queryKey: ["recording", recordingId],
    queryFn: () => getRecording(recordingId),
    enabled: Boolean(recordingId),
    refetchInterval: (query) => (["ready", "failed"].includes(query.state.data?.state ?? "") ? false : 2_000),
  });
  const run = useMutation({
    mutationFn: (mode: PlaybackMode) => createRecordingPlaybackRun(
      recordingId,
      mode === "normal" ? NORMAL_PLAYBACK_PROFILE : ABR_PRESET_PROFILE,
      faultPlanForMode(mode),
    ),
    onSuccess: ({ run: created }) => {
      setPlayback(created);
    },
  });
  const latestPlayback = useQuery({
    queryKey: ["recording-latest-playback", recordingId],
    queryFn: () => getLatestRecordingPlaybackRun(recordingId),
    enabled: Boolean(recordingId) && recording.data?.state === "ready",
  });
  const finish = useMutation({
    mutationFn: () => finishRecordingPlaybackRun(recordingId, playback!.id),
    onSuccess: (completed) => {
      setLastRun(completed);
      setPlayback(undefined);
      void client.invalidateQueries({ queryKey: ["recording-latest-playback", recordingId] });
    },
  });
  const requests = useQuery({
    queryKey: ["recording-requests", recordingId, playback?.id],
    queryFn: () => getRecordingRequests(recordingId, playback!.id),
    enabled: Boolean(playback?.id),
    refetchInterval: (query) => (query.state.data && playback ? isTerminal(playback) ? false : 2_000 : 2_000),
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

  useEffect(() => {
    if (!latestPlayback.data) return;
    setPlayback(latestPlayback.data.run);
  }, [latestPlayback.data]);

  function updateScenario(next: ResilienceScenarioId | undefined): void {
    setScenario(next);
    navigate(`/recordings/${recordingId}${next ? `?scenario=${next}` : ""}`, { replace: true });
  }

  if (recording.isLoading) return <Shell><p className="mt-24 text-center text-sm text-harness-muted">Opening recording…</p></Shell>;
  if (recording.error) return <Shell><p className="mt-24 text-center text-rose-300">{recording.error.message}</p></Shell>;
  if (!recording.data) return <Shell />;

  const value = recording.data;
  const meta = STATE_META[value.state];
  const fixedPlaybackUrl = new URL(`/streams/recordings/${value.id}/index.${value.protocol === "dash" ? "mpd" : "m3u8"}`, window.location.origin).toString();

  return (
    <Shell>
      <section className="p-6 sm:p-8">
        <header className="animate-fade-up flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs font-semibold shadow-sm ${meta.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${value.state === "collecting" || value.state === "validating" ? "animate-pulse-dot" : ""}`} />
            {meta.label}
          </span>
          <span className="font-mono text-[11px] text-slate-400">record {shortId(value.id)}</span>
          <span className="ml-auto hidden text-xs text-slate-400 sm:inline">
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Recording dashboard</h1>
            <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{value.sourceUrl}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <Metric label="Requested window" value={`${value.requestedDurationSeconds}s`} hint={`from ${value.requestedStartSeconds}s`} />
          <Metric label="Effective coverage" value={value.coverageSeconds ? `${value.coverageSeconds.toFixed(1)}s` : "—"} hint="validated window" />
          <Metric label="Stored" value={value.totalBytes ? formatBytes(value.totalBytes) : "—"} hint="all variants" />
          <Metric label="Protocol" value={value.protocol.toUpperCase()} hint={value.protocol === "dash" ? "static fMP4 · VOD" : "clear MPEG-TS · VOD"} />
        </div>

        {value.state === "ready" && (
          <>
            <ShapingPanel
              run={playback}
              url={fixedPlaybackUrl}
              copied={copied}
              creating={run.isPending}
              selectedScenario={scenario}
              onScenarioChange={updateScenario}
              error={run.error?.message}
              onStart={(mode) => run.mutate(mode)}
              stopping={finish.isPending}
              stopError={finish.error?.message}
              onStop={() => finish.mutate()}
              onCopy={() => {
                void navigator.clipboard.writeText(fixedPlaybackUrl).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
            />
            {(lastRun ?? playback) && <AbrDashboard run={(lastRun ?? playback)!} items={requests.data ?? []} />}
            {playback && !isTerminal(playback) && <RecordingBrowserPlayer protocol={value.protocol} url={fixedPlaybackUrl} />}
            {lastRun && playback === undefined && (
              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                Last test run finished. The evidence above reflects its final state — choose a condition and Start to test again.
              </div>
            )}
          </>
        )}

        {value.state === "failed" && (
          <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700">
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
  selectedScenario?: ResilienceScenarioId;
  onScenarioChange: (scenario: ResilienceScenarioId | undefined) => void;
  error?: string;
  onStart: (mode: PlaybackMode) => void;
  stopping: boolean;
  stopError?: string;
  onStop: () => void;
  onCopy: () => void;
}): JSX.Element {
  const profile = props.run?.profile;
  const stages = profile?.stages ?? ABR_PRESET_PROFILE.stages;
  const isNormal = profile?.name === NORMAL_PLAYBACK_PROFILE.name;
  const canStart = !props.run || isTerminal(props.run);
  const [choice, setChoice] = useState<"normal" | "controlled" | null>(() => props.selectedScenario ? "controlled" : profile ? (isNormal ? "normal" : "controlled") : null);
  const [network, setNetwork] = useState<"normal" | "abr" | null>(null);
  const [fault, setFault] = useState<ResilienceScenarioId | null>(() => props.selectedScenario ?? null);

  const readyToStart = canStart && !props.creating && choice !== null;
  function startSelected(): void {
    if (!readyToStart) return;
    if (choice === "normal") {
      props.onScenarioChange(undefined);
      props.onStart("normal");
      return;
    }
    if (fault) {
      props.onScenarioChange(fault);
      props.onStart(`resilience-${fault}`);
      return;
    }
    if (network === "abr") {
      props.onScenarioChange(undefined);
      props.onStart("force-abr");
      return;
    }
    props.onScenarioChange(undefined);
    props.onStart("normal");
  }

  const selectedFault = fault ? RESILIENCE_SCENARIOS[fault] : undefined;
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="p-0 sm:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Playback mode</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">{profile ? (selectedFault ? selectedFault.title : isNormal ? "Normal playback" : "Controlled playback") : "How do you want to test?"}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {profile ? (selectedFault ? `${selectedFault.description} The journal records every applied rule.` : isNormal ? "A generous, stable local network profile with no intentional ABR pressure." : "A constrained interval followed by recovery, so the player's representation requests reveal ABR behavior.") : "Choose a condition below, then start the test. Nothing starts until you press Start."}
            </p>
          </div>
          {props.run && !isTerminal(props.run) && (
            <button className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600 transition hover:border-rose-300 disabled:opacity-45" disabled={props.stopping} onClick={props.onStop}>
              {props.stopping ? "Stopping…" : "Stop test run"}
            </button>
          )}
        </div>

        {!profile && canStart && (
          <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                title="Normal playback"
                description="Stable network, no injected conditions. Best as a clean baseline."
                icon={<PlayIcon />}
                selected={choice === "normal"}
                onSelect={() => { setChoice("normal"); setNetwork(null); setFault(null); }}
                primary
              />
              <ChoiceCard
                title="Controlled conditions"
                description="Simulate a slow network, ABR pressure, HTTP errors, or delays."
                icon={<SluceIcon />}
                selected={choice === "controlled"}
                onSelect={() => setChoice("controlled")}
              />
            </div>
          </div>
        )}

        {choice === "controlled" && !profile && canStart && (
          <div className="mt-6 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Network profile</p>
              <p className="mt-1 text-sm text-slate-500">Constrain bandwidth then recover, so the player can show an ABR switch.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <ConditionButton title="Force ABR" description="Constrained interval followed by recovery." selected={fault === null && network === "abr"} onSelect={() => { setNetwork("abr"); setFault(null); }} />
                <ConditionButton title="Keep normal" description="Stable network; only inject a fault below." selected={fault === null && network !== "abr"} onSelect={() => setNetwork("normal")} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Delivery fault <span className="font-normal text-slate-400">optional</span></p>
              <p className="mt-1 text-sm text-slate-500">Inject a deterministic failure into the request path.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <ConditionButton title="No fault" description="Serve every request normally." selected={fault === null} onSelect={() => setFault(null)} />
                {RESILIENCE_SCENARIO_IDS.map((id) => {
                  const item = RESILIENCE_SCENARIOS[id];
                  return <ConditionButton key={id} title={item.title} description={item.description} selected={fault === id} onSelect={() => setFault(id)} />;
                })}
              </div>
            </div>
          </div>
        )}

        {choice !== null && !profile && canStart && (
          <button
            onClick={startSelected}
            disabled={!readyToStart}
            className="group relative mt-6 h-14 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-violet-500 to-fuchsia-500 text-base font-bold text-white shadow-lg shadow-violet-300/40 transition hover:shadow-xl hover:shadow-violet-300/50 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            <span className="relative">{props.creating ? "Starting…" : "Start playback"}</span>
          </button>
        )}

        {profile && <ShapingStepper stages={stages} activeIndex={props.run ? undefined : 0} />}

          {props.run && props.url && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 break-all font-mono text-sm text-violet-800">{props.url}</p>
                <button className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700" onClick={props.onCopy}>
                  {props.copied ? "Copied" : "Copy playback URL"}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-violet-700/70">This URL is fixed for the recording and never changes. A test run applies its shaping while active; without a run the clone is served with the baseline profile.</p>
            </div>
          )}
        {props.error && <p className="mt-4 text-sm text-rose-600">{props.error}</p>}
        {props.stopError && <p className="mt-4 text-sm text-rose-600">{props.stopError}</p>}
      </div>
    </section>
  );
}

function ChoiceCard(props: { title: string; description: string; icon: ReactNode; selected: boolean; onSelect: () => void; primary?: boolean }): JSX.Element {
  const theme = props.primary
    ? "from-sky-500 via-sky-400 to-violet-400"
    : "from-violet-500 via-fuchsia-500 to-fuchsia-400";
  const selectedRing = props.primary ? "ring-sky-200 shadow-sky-200/50" : "ring-fuchsia-200 shadow-fuchsia-200/50";
  return (
    <button
      onClick={props.onSelect}
      className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition duration-200 ${props.selected ? `border-white/60 bg-gradient-to-br ${theme} ring-2 ${selectedRing} shadow-xl` : `border-white/60 bg-gradient-to-br ${theme} shadow-[0_14px_38px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 hover:shadow-[0_22px_50px_rgba(15,23,42,0.26)]`}`}
      type="button"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/30 blur-2xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-12 -left-10 h-28 w-28 rounded-full bg-black/10 blur-2xl" />
      <div className="relative flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20 text-white shadow-sm ring-1 ring-white/40 backdrop-blur-sm">
          {props.icon}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-white">{props.title}</p>
          <p className="mt-1 text-sm leading-5 text-white/85">{props.description}</p>
        </div>
      </div>
    </button>
  );
}

function ConditionButton(props: { title: string; description: string; selected: boolean; onSelect: () => void }): JSX.Element {
  return (
    <button
      onClick={props.onSelect}
      className={`group relative overflow-hidden rounded-xl border p-3 text-left text-sm transition ${props.selected ? "border-violet-400 bg-gradient-to-br from-violet-100 to-fuchsia-50 ring-2 ring-violet-200 shadow-sm" : "border-white/70 bg-gradient-to-br from-white/70 to-violet-50/50 hover:border-violet-300/70 hover:from-white/90 hover:shadow-sm"}`}
      type="button"
    >
      <span className="font-semibold text-slate-800">{props.title}</span>
      <span className="mt-1 block text-xs text-slate-500">{props.description}</span>
    </button>
  );
}

function PlayIcon(): JSX.Element {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="m8 5 11 7-11 7V5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function SluceIcon(): JSX.Element {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /><circle cx="15" cy="7" r="1.6" fill="currentColor" /><circle cx="9" cy="12" r="1.6" fill="currentColor" /><circle cx="15" cy="17" r="1.6" fill="currentColor" /></svg>;
}

function isTerminal(run: PlaybackRun): boolean { return run.state === "completed" || run.state === "expired" || run.state === "failed"; }

function ShapingStepper({ stages, activeIndex }: { stages: readonly NetworkProfileStage[]; activeIndex?: number }): JSX.Element {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {stages.map((stage, index) => (
        <div key={index} className={`rounded-2xl border p-4 transition ${activeIndex === index ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${activeIndex === index ? "bg-violet-600 text-white" : "bg-white text-slate-500"}`}>{index + 1}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">after #{stage.afterVideoRequests} video</span>
          </div>
          <p className="mt-3 font-mono text-lg font-semibold text-slate-900">{stage.bandwidthKbps.toLocaleString()} <span className="text-xs font-normal text-slate-400">kbps</span></p>
          <p className="text-xs text-slate-500">{stage.latencyMs} ms latency</p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Live playback run</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">ABR evidence</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-500" />
          {stats.variantChanges > 0 ? `${stats.variantChanges} variant change${stats.variantChanges > 1 ? "s" : ""} observed` : items.length > 0 ? "collecting attempts…" : "waiting for device…"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Metric label="Requests" value={String(stats.total)} hint="all resources" />
        <Metric label="Video picks" value={String(stats.video)} hint="segment requests" />
        <Metric label="Avg latency" value={stats.avgLatency === null ? "—" : `${stats.avgLatency} ms`} hint="served" />
        <Metric label="Injected faults" value={String(stats.faults)} hint="journaled delivery rules" />
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
            <line x1={padL} x2={W - padR} y1={py(tick)} y2={py(tick)} stroke="rgba(15,23,42,0.08)" strokeWidth={1} />
            <text x={padL - 8} y={py(tick) + 3} className="fill-slate-400 font-mono text-[10px]" textAnchor="end">{fmtShortKbps(tick)}</text>
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
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
        <Legend swatch="bg-sky-400" label="Shaped bandwidth" />
        <Legend swatch="bg-fuchsia-500" label="Player selection" />
        {stages.map((_, i) => (
          <Legend key={i} swatch={STAGE_COLORS[i] ?? "bg-slate-300"} label={i === 0 ? "Good" : i === 1 ? "Constrained" : "Recovery"} />
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
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-slate-500">
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
              className={`flex items-center gap-3 rounded-xl border p-3 text-sm transition ${item.id === lastId ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50"}`}
            >
              <span className={`h-9 w-1 shrink-0 rounded-full ${kindColor[item.resourceKind] ?? "bg-slate-300"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[11px] text-slate-400">t+{relS}s</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABEL[item.resourceKind] ?? item.resourceKind}</span>
                  {item.faultRuleId && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">Fault · {item.faultAction}</span>}
                  {item.variantResolution ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-500" />
                        {item.variantResolution}
                      </span>
                      {item.variantBandwidth !== undefined && <span className="font-mono text-xs text-slate-400">{fmtKbps(item.variantBandwidth)}</span>}
                    </>
                  ) : (
                    item.mediaSequence !== undefined && <span className="font-mono text-xs text-slate-400">seq {item.mediaSequence}</span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{item.logicalPath}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div className="flex items-center justify-end gap-1.5 text-slate-700">
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono ${STAGE_CHIP[item.stageIndex] ?? "border-slate-200 bg-white text-slate-500"}`}>S{item.stageIndex + 1}</span>
                  <span className="font-mono">{item.latencyMs} ms</span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-slate-400">{formatBytes(item.bytesSent)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs leading-5 text-slate-500">
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
          <li key={event.id} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400/70 to-violet-500/70 text-[10px] font-bold text-white">
              {event.actor?.slice(0, 1) ?? "R"}
            </span>
            <div className="min-w-0">
              <p className="text-slate-800">{event.message}</p>
              <p className="mt-0.5 text-xs text-slate-400">
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
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }): JSX.Element {
  return (
    <div className="grid h-[250px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50">
      <p className="max-w-xs text-center text-sm text-slate-400">{label}</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
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
        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200/90 bg-[#f7f7fb] text-slate-700 shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
          {children}
        </div>
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

const STAGE_COLORS = ["bg-emerald-500", "bg-amber-500", "bg-violet-500"];
const STAGE_FILL = ["rgba(16,185,129,0.10)", "rgba(245,158,11,0.10)", "rgba(139,92,246,0.10)"];
const STAGE_CHIP = [
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-violet-200 bg-violet-50 text-violet-700",
];

const kindColor: Record<string, string> = {
  master: "bg-slate-300",
  "media-playlist": "bg-sky-400",
  "video-segment": "bg-fuchsia-500",
  "audio-segment": "bg-violet-500",
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

function summarize(items: DeliveryRequest[]): { total: number; video: number; faults: number; variantChanges: number; avgLatency: number | null; avgBandwidth: number | null } {
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
  return { total: items.length, video: videos.length, faults: items.filter((item) => item.faultRuleId !== undefined).length, variantChanges, avgLatency, avgBandwidth };
}

function fmtShortKbps(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(0)}M` : String(kbps);
}

function fmtKbps(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}
