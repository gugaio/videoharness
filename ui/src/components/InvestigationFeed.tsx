import { useEffect, useMemo, useRef } from "react";
import type { Investigation, InvestigationEvent } from "../lib/api";
import { formatTime } from "../lib/format";
import { AgentAvatar, hueStyle, personaForActor, personaForSpecialist, type AgentPersona } from "./agents";

const WORKING_COPY: Record<string, { actor: string; message: string }> = {
  queued: { actor: "system", message: "Case is queued. An agent will claim it in a moment…" },
  validating: { actor: "Network Agent", message: "Checking the destination is safe before any network access…" },
  collecting: { actor: "Media Agent", message: "Fetching manifests and bounded media samples as evidence…" },
  analyzing: { actor: "AI Investigation Team", message: "Specialists are correlating the deterministic evidence…" },
  synthesizing: { actor: "Investigator", message: "Putting the final report together…" },
};

const AI_AGENT_ORDER = ["timeline-playback", "container-encoding", "manifest-delivery", "abr-switch-investigator", "lead-investigator"] as const;

type AiAgentStage = "started" | "completed" | "failed";

interface AiTeamProgress {
  stages: Partial<Record<(typeof AI_AGENT_ORDER)[number], AiAgentStage>>;
  completed: number;
  total: number;
}

const COLLECTION_STAGES = ["root_manifest", "variant_manifest", "rendition_manifest", "media_sample", "media_probe"] as const;

const COLLECTION_STAGE_LABELS: Record<(typeof COLLECTION_STAGES)[number], string> = {
  root_manifest: "Root manifest",
  variant_manifest: "Video variant",
  rendition_manifest: "Audio rendition",
  media_sample: "Media samples",
  media_probe: "FFprobe inspection",
};

interface CollectionProgress {
  stage: (typeof COLLECTION_STAGES)[number];
  message: string;
  completed?: number;
  total?: number;
}

/** Live, counted progress derived from persisted collection events; never an estimate. */
function deriveCollectionProgress(events: InvestigationEvent[]): { latest: CollectionProgress; stages: Partial<Record<(typeof COLLECTION_STAGES)[number], "done" | "active">> } | undefined {
  const stages: Partial<Record<(typeof COLLECTION_STAGES)[number], "done" | "active">> = {};
  let latest: CollectionProgress | undefined;
  for (const event of events) {
    if (event.type !== "investigation.observation" || event.payload.stage !== "collection") continue;
    const stage = event.payload.collectionStage;
    if (typeof stage !== "string" || !(COLLECTION_STAGES as readonly string[]).includes(stage)) continue;
    latest = {
      stage: stage as CollectionProgress["stage"],
      message: event.message,
      ...(typeof event.payload.completed === "number" ? { completed: event.payload.completed } : {}),
      ...(typeof event.payload.total === "number" ? { total: event.payload.total } : {}),
    };
    stages[latest.stage] = "done";
  }
  if (!latest) return undefined;
  stages[latest.stage] = "active";
  return { latest, stages };
}

function isCollectionProgress(event: InvestigationEvent): boolean {
  return (
    event.type === "investigation.observation" &&
    event.payload.stage === "collection"
  );
}

/** Real per-agent lifecycle derived from persisted pipeline events; never an estimate. */
function deriveAiTeamProgress(events: InvestigationEvent[]): AiTeamProgress | undefined {
  const stages: AiTeamProgress["stages"] = {};
  let completed: number = 0;
  let total: number = 5;
  let seen = false;
  for (const event of events) {
    if (event.type !== "investigation.observation" || event.payload.stage !== "ai_agent") continue;
    const agent = typeof event.payload.agent === "string" ? event.payload.agent : "";
    const agentStage = event.payload.agentStage;
    if (!(AI_AGENT_ORDER as readonly string[]).includes(agent)) continue;
    if (agentStage !== "started" && agentStage !== "completed" && agentStage !== "failed") continue;
    stages[agent as (typeof AI_AGENT_ORDER)[number]] = agentStage;
    seen = true;
    if (typeof event.payload.completed === "number") completed = event.payload.completed;
    if (typeof event.payload.total === "number") total = event.payload.total;
  }
  return seen ? { stages, completed, total } : undefined;
}

function isAiAgentStart(event: InvestigationEvent): boolean {
  return (
    event.type === "investigation.observation" &&
    event.payload.stage === "ai_agent" &&
    event.payload.agentStage === "started"
  );
}

export function InvestigationFeed(props: {
  events: InvestigationEvent[];
  state: Investigation["state"];
  connected: boolean;
}): JSX.Element {
  const { events, state, connected } = props;
  const active = state !== "completed" && state !== "failed";
  const feedEndRef = useRef<HTMLDivElement>(null);

  const team = useMemo(() => {
    const seen = new Map<string, AgentPersona>();
    for (const event of events) {
      if (event.actor === "system") continue;
      if (!seen.has(event.actor)) seen.set(event.actor, personaForActor(event.actor));
    }
    return [...seen.values()];
  }, [events]);

  const aiProgress = useMemo(() => deriveAiTeamProgress(events), [events]);
  const collectionProgress = useMemo(() => deriveCollectionProgress(events), [events]);

  useEffect(() => {
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 480;
    if (nearBottom) feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, active]);

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-white/40">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse-dot" : "bg-amber-300"}`} />
            {active ? "Live from the team" : "How it unfolded"}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">The investigation feed</h2>
        </div>
        <span className="text-xs text-white/35">{events.length} update{events.length === 1 ? "" : "s"}</span>
      </div>

      {team.length > 0 && (
        <div className="mt-5 flex items-center gap-3">
          <div className="flex -space-x-2.5">
            {team.map((persona) => (
              <span className="rounded-xl ring-2 ring-harness-bg" key={persona.name + persona.role}>
                <AgentAvatar persona={persona} size="sm" />
              </span>
            ))}
          </div>
          <p className="text-xs text-white/45">
            <span className="text-white/75">{team.map((persona) => persona.name).join(", ")}</span> on this case
          </p>
        </div>
      )}

      <div className="mt-7 space-y-4">
        {events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-harness-muted">
            Restoring the persisted investigation feed…
          </div>
        )}
        {events.filter((event) => !isAiAgentStart(event) && !isCollectionProgress(event)).map((event, index) =>
          isMilestone(event) ? (
            <Milestone event={event} key={event.id} stagger={staggerDelay(index)} />
          ) : (
            <FeedPost event={event} key={event.id} stagger={staggerDelay(index)} />
          ),
        )}
        {active && (
          <WorkingCard
            aiProgress={aiProgress}
            collectionProgress={
              collectionProgress ? { ...collectionProgress.latest, stages: collectionProgress.stages } : undefined
            }
            state={state}
          />
        )}
      </div>
      <div ref={feedEndRef} />
    </section>
  );
}

function isMilestone(event: InvestigationEvent): boolean {
  return event.actor === "system" && event.type === "investigation.state_changed";
}

function staggerDelay(index: number): number {
  return Math.min(index, 8) * 60;
}

function Milestone({ event, stagger }: { event: InvestigationEvent; stagger: number }): JSX.Element {
  return (
    <div className="flex animate-fade-up items-center gap-4 py-1" style={{ animationDelay: `${stagger}ms` }}>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-white/55">
        {event.message}
        <time className="text-white/30">{formatTime(event.createdAt)}</time>
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
    </div>
  );
}

function FeedPost({ event, stagger }: { event: InvestigationEvent; stagger: number }): JSX.Element {
  const persona = personaForActor(event.actor);
  const hue = hueStyle(persona.hue);
  const isEvidence = event.type === "investigation.evidence_found";
  const isReport = event.type === "investigation.report_ready";

  return (
    <article
      className={`animate-fade-up rounded-2xl border p-5 shadow-card transition-colors ${
        isReport
          ? "border-emerald-300/20 bg-emerald-300/[0.05]"
          : isEvidence
            ? "border-amber-300/15 bg-amber-300/[0.03]"
            : "border-white/[0.07] bg-harness-panel/70"
      }`}
      style={{ animationDelay: `${stagger}ms` }}
    >
      <div className="flex items-start gap-4">
        <AgentAvatar persona={persona} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-sm font-semibold text-white/90">{persona.name}</span>
            <span className={`text-xs font-medium ${hue.text}`}>{persona.role}</span>
            <time className="ml-auto text-xs text-white/30">{formatTime(event.createdAt)}</time>
          </div>
          <p className="mt-1.5 text-pretty text-sm leading-6 text-white/80">{event.message}</p>
          {isEvidence && <EvidenceChips payload={event.payload} />}
          {isReport && (
            <a
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-300/20"
              href="#report"
            >
              Jump to the report
              <span aria-hidden="true">↓</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function EvidenceChips({ payload }: { payload: Record<string, unknown> }): JSX.Element | null {
  const chips: string[] = [];
  const protocol = payload.protocol;
  if (protocol === "hls" || protocol === "dash") chips.push(protocol.toUpperCase());
  const artifactIds = Array.isArray(payload.artifactIds) ? payload.artifactIds.length : 0;
  if (artifactIds > 0) chips.push(`${artifactIds} manifest${artifactIds === 1 ? "" : "s"}`);
  const samples = typeof payload.mediaSampleCount === "number" ? payload.mediaSampleCount : 0;
  if (samples > 0) chips.push(`${samples} media sample${samples === 1 ? "" : "s"}`);
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2.5 py-1 text-[11px] font-medium text-amber-200/90"
          key={chip}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function WorkingCard({
  state,
  aiProgress,
  collectionProgress,
}: {
  state: Investigation["state"];
  aiProgress?: AiTeamProgress;
  collectionProgress?: CollectionProgress & { stages: Partial<Record<(typeof COLLECTION_STAGES)[number], "done" | "active">> };
}): JSX.Element {
  if (state === "analyzing" && aiProgress) return <AiTeamWorkingCard progress={aiProgress} />;
  if (state === "collecting" && collectionProgress) return <CollectionWorkingCard progress={collectionProgress} />;
  const copy = WORKING_COPY[state] ?? WORKING_COPY.queued;
  const persona = personaForActor(copy.actor);
  return (
    <article className="animate-fade-up rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5">
      <div className="flex items-center gap-4">
        <AgentAvatar active persona={persona} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white/75">
            {persona.name} is working
            <span className="ml-2 inline-flex items-end gap-1 align-baseline">
              <TypingDot delay="0ms" />
              <TypingDot delay="150ms" />
              <TypingDot delay="300ms" />
            </span>
          </p>
          <p className="mt-1 text-sm text-white/45">{copy.message}</p>
        </div>
      </div>
    </article>
  );
}

function CollectionWorkingCard({ progress }: { progress: CollectionProgress & { stages: Partial<Record<(typeof COLLECTION_STAGES)[number], "done" | "active">> } }): JSX.Element {
  const persona = personaForActor("Media Agent");
  const doneCount = COLLECTION_STAGES.filter((stage) => progress.stages[stage] === "done").length;
  return (
    <article className="animate-fade-up rounded-2xl border border-dashed border-amber-300/25 bg-amber-300/[0.04] p-5">
      <div className="flex items-center gap-4">
        <AgentAvatar active persona={persona} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white/75">
            {persona.name} is collecting evidence
            <span className="ml-2 inline-flex items-end gap-1 align-baseline">
              <TypingDot delay="0ms" />
              <TypingDot delay="150ms" />
              <TypingDot delay="300ms" />
            </span>
          </p>
          <p className="mt-1 text-sm text-white/45">{progress.message}</p>
          {progress.completed !== undefined && progress.total !== undefined && progress.total > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>
                  {progress.completed} of {progress.total} complete
                </span>
                <span>{Math.min(100, Math.round((progress.completed / progress.total) * 100))}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-amber-400 transition-[width]"
                  style={{ width: `${Math.min(100, Math.round((progress.completed / progress.total) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
        {COLLECTION_STAGES.map((stage) => {
          const state = progress.stages[stage];
          const label = COLLECTION_STAGE_LABELS[stage];
          return (
            <li
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                state === "done"
                  ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                  : state === "active"
                    ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
                    : "border-white/10 bg-white/[0.03] text-white/35"
              }`}
              key={stage}
            >
              {state === "done" ? (
                <svg aria-hidden="true" className="h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
                </svg>
              ) : state === "active" ? (
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-amber-300" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
              )}
              {label}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-white/30">
        {doneCount} of {COLLECTION_STAGES.length} collection stages done — each sample is fetched through the safe network boundary.
      </p>
    </article>
  );
}

function AiTeamWorkingCard({ progress }: { progress: AiTeamProgress }): JSX.Element {
  const persona = personaForActor("AI Investigation Team");
  return (
    <article className="animate-fade-up rounded-2xl border border-dashed border-fuchsia-300/25 bg-fuchsia-300/[0.04] p-5">
      <div className="flex items-center gap-4">
        <AgentAvatar active persona={persona} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white/75">
            {persona.name} is coordinating the AI team
            <span className="ml-2 inline-flex items-end gap-1 align-baseline">
              <TypingDot delay="0ms" />
              <TypingDot delay="150ms" />
              <TypingDot delay="300ms" />
            </span>
          </p>
          <p className="mt-1 text-sm text-white/45">
            {progress.completed} of {progress.total} analyses complete — each specialist reviews the evidence independently.
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5 border-t border-white/[0.06] pt-4">
        {AI_AGENT_ORDER.map((agentId) => {
          const agent = personaForSpecialist(agentId);
          const stage = progress.stages[agentId];
          return (
            <li className="flex items-center gap-3" key={agentId}>
              <AgentAvatar active={stage === "started"} persona={agent} size="sm" />
              <span className="text-sm font-medium text-white/80">{agent.name}</span>
              <span className="truncate text-xs text-white/35">{agent.role}</span>
              <AgentStageBadge stage={stage} />
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function AgentStageBadge({ stage }: { stage?: AiAgentStage }): JSX.Element {
  if (stage === "completed") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-300">
        <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
          <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        </svg>
        Done
      </span>
    );
  }
  if (stage === "failed") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-rose-300">
        <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
          <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
        </svg>
        Failed
      </span>
    );
  }
  if (stage === "started") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-fuchsia-200">
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-fuchsia-300" />
        Analyzing
      </span>
    );
  }
  return <span className="ml-auto shrink-0 text-xs text-white/30">Waiting</span>;
}

function TypingDot({ delay }: { delay: string }): JSX.Element {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-typing-dot rounded-full bg-white/60"
      style={{ animationDelay: delay }}
    />
  );
}
