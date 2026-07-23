import { useEffect, useMemo, useRef } from "react";
import type { Investigation, InvestigationEvent } from "../lib/api";
import { formatTime } from "../lib/format";
import { AgentAvatar, hueStyle, personaForActor, type AgentPersona } from "./agents";

const WORKING_COPY: Record<string, { actor: string; message: string }> = {
  queued: { actor: "system", message: "Case is queued. An agent will claim it in a moment…" },
  validating: { actor: "Network Agent", message: "Checking the destination is safe before any network access…" },
  collecting: { actor: "Media Agent", message: "Fetching manifests and bounded media samples as evidence…" },
  analyzing: { actor: "AI Investigation Team", message: "Specialists are correlating the deterministic evidence…" },
  synthesizing: { actor: "Investigator", message: "Putting the final report together…" },
};

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
        {events.map((event, index) =>
          isMilestone(event) ? (
            <Milestone event={event} key={event.id} stagger={staggerDelay(index)} />
          ) : (
            <FeedPost event={event} key={event.id} stagger={staggerDelay(index)} />
          ),
        )}
        {active && <WorkingCard state={state} />}
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

function WorkingCard({ state }: { state: Investigation["state"] }): JSX.Element {
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

function TypingDot({ delay }: { delay: string }): JSX.Element {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-typing-dot rounded-full bg-white/60"
      style={{ animationDelay: delay }}
    />
  );
}
