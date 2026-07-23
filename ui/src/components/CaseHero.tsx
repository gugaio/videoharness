import type { Investigation } from "../lib/api";
import { formatDateTime, formatDuration, shortId } from "../lib/format";

const STATE_META: Record<Investigation["state"], { label: string; chip: string; dot: string }> = {
  queued: { label: "Queued", chip: "border-white/15 bg-white/[0.06] text-white/70", dot: "bg-slate-300" },
  validating: { label: "Validating", chip: "border-sky-300/25 bg-sky-300/10 text-sky-200", dot: "bg-sky-400" },
  collecting: { label: "Collecting evidence", chip: "border-amber-300/25 bg-amber-300/10 text-amber-200", dot: "bg-amber-400" },
  analyzing: { label: "Analyzing", chip: "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-200", dot: "bg-fuchsia-400" },
  synthesizing: { label: "Writing report", chip: "border-violet-300/25 bg-violet-300/10 text-violet-200", dot: "bg-violet-400" },
  completed: { label: "Completed", chip: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200", dot: "bg-emerald-400" },
  failed: { label: "Failed", chip: "border-rose-300/25 bg-rose-300/10 text-rose-200", dot: "bg-rose-400" },
};

function isActive(state: Investigation["state"]): boolean {
  return state !== "completed" && state !== "failed";
}

function headlineFor(state: Investigation["state"]): string {
  switch (state) {
    case "completed":
      return "Your stream, investigated.";
    case "failed":
      return "We hit a wall on this one.";
    case "queued":
      return "Waking up the team…";
    default:
      return "Agents are on the case…";
  }
}

function sublineFor(state: Investigation["state"]): string {
  switch (state) {
    case "completed":
      return "The team finished the analysis. The full story is below.";
    case "failed":
      return "The investigation could not be completed. The timeline shows where it stopped.";
    case "queued":
      return "The case is in the queue. An agent will pick it up in a moment.";
    case "validating":
      return "Checking the destination safely before touching the stream.";
    case "collecting":
      return "Fetching manifests and bounded media samples as evidence.";
    case "analyzing":
      return "Specialists are reading the evidence and forming hypotheses.";
    case "synthesizing":
      return "The lead investigator is writing your report.";
  }
}

export function CaseHero({ investigation }: { investigation: Investigation }): JSX.Element {
  const state = STATE_META[investigation.state];
  const active = isActive(investigation.state);
  const hostname = safeHostname(investigation.sourceUrl);

  return (
    <section className="animate-fade-up overflow-hidden rounded-3xl border border-white/[0.08] bg-harness-panel/80 shadow-card">
      <div className="relative p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-gradient-to-br from-sky-400/15 via-violet-400/15 to-fuchsia-400/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${state.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${state.dot} ${active ? "animate-pulse-dot" : ""}`} />
            {state.label}
          </span>
          <span className="font-mono text-[11px] text-white/30">case {shortId(investigation.id)}</span>
          <span className="ml-auto text-xs text-white/35">
            {investigation.completedAt
              ? `Ran for ${formatDuration(investigation.createdAt, investigation.completedAt)}`
              : `Opened ${formatDateTime(investigation.createdAt)}`}
          </span>
        </div>

        <h1 className="relative mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {headlineFor(investigation.state)}
        </h1>
        <p className="relative mt-2.5 max-w-2xl text-pretty text-sm leading-6 text-harness-muted sm:text-base">
          {sublineFor(investigation.state)}
        </p>

        <div className="relative mt-6 flex flex-wrap items-center gap-2.5">
          <a
            className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-white/10 bg-black/30 py-2 pl-3 pr-4 text-sm text-white/80 transition hover:border-white/25 hover:text-white"
            href={investigation.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400/80 to-violet-500/80 text-[10px] font-bold text-white">
              {hostname.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate font-medium">{hostname}</span>
            <span className="truncate font-mono text-xs text-white/35">{safePath(investigation.sourceUrl)}</span>
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
            HLS · MPEG-TS
          </span>
        </div>

        {investigation.problemDescription && (
          <figure className="relative mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="absolute inset-y-5 left-0 w-0.5 rounded-full bg-gradient-to-b from-sky-400/60 to-violet-400/60" />
            <figcaption className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
              What you reported
            </figcaption>
            <blockquote className="mt-2 text-pretty text-sm leading-6 text-white/85">
              {investigation.problemDescription}
            </blockquote>
          </figure>
        )}

        {active && (
          <div aria-hidden="true" className="relative mt-7 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full w-2/5 animate-shimmer rounded-full bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
          </div>
        )}
      </div>
    </section>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" ? "" : parsed.pathname;
  } catch {
    return "";
  }
}
