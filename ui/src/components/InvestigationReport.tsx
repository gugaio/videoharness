import type { InvestigationReport } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/format";
import {
  AgentAvatar,
  SEVERITY_STYLES,
  confidenceTone,
  personaForSpecialist,
  type Severity,
} from "./agents";

type ReportContent = InvestigationReport["content"];
type EvidenceContent = Extract<ReportContent, { placeholder: false }>;
type AiLayer = NonNullable<EvidenceContent["ai"]>;
type AiFinding = AiLayer["findings"][number];

export function InvestigationReportView({ report }: { report: InvestigationReport }): JSX.Element {
  const { content } = report;
  return (
    <section className="mt-14 scroll-mt-24" id="report">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/40">Final report</p>
      {content.placeholder ? (
        <PlaceholderReport content={content} />
      ) : (
        <EvidenceReport content={content} createdAt={report.createdAt} />
      )}
    </section>
  );
}

/* ============================== Verdict ============================== */

function PlaceholderReport({ content }: { content: Extract<ReportContent, { placeholder: true }> }): JSX.Element {
  return (
    <div className="mt-4 rounded-3xl border border-white/[0.08] bg-harness-panel/80 p-6 sm:p-8">
      <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/55">
        Technical placeholder
      </span>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">{content.title}</h2>
      <p className="mt-3 max-w-2xl text-pretty leading-7 text-harness-muted">{content.summary}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {content.findings.map((finding) => (
          <article className="rounded-2xl border border-white/[0.07] bg-black/20 p-5" key={finding.title}>
            <p className="text-sm font-medium">{finding.title}</p>
            <p className="mt-2 text-sm leading-6 text-harness-muted">{finding.explanation}</p>
          </article>
        ))}
        <article className="rounded-2xl border border-white/[0.07] bg-black/20 p-5">
          <p className="text-sm font-medium">Confidence not assessed</p>
          <p className="mt-2 text-sm leading-6 text-harness-muted">{content.confidence.explanation}</p>
        </article>
      </div>
    </div>
  );
}

function EvidenceReport({ content, createdAt }: { content: EvidenceContent; createdAt: string }): JSX.Element {
  const ai = content.ai?.available ? content.ai : undefined;
  const dashEvidence = getDashEvidence(content.evidence);
  const attentionFindings = ai?.findings.filter((finding) => finding.severity !== "info") ?? [];
  const observedFindings = ai?.findings.filter((finding) => finding.severity === "info") ?? [];

  return (
    <div className="mt-4 space-y-8">
      <VerdictCard ai={ai} content={content} createdAt={createdAt} />
      {dashEvidence && <DashForensics evidence={dashEvidence.evidence} reported={dashEvidence.reported} />}
      {ai && ai.recommendations.length > 0 && <Recommendations recommendations={ai.recommendations} />}
      {ai && ai.findings.length > 0 && (
        <Findings attention={attentionFindings} observed={observedFindings} />
      )}
      {ai && ai.agents.length > 0 && <AgentRoster agents={ai.agents} />}
      <EvidenceDetails content={content} />
      <Limitations ai={ai} content={content} />
    </div>
  );
}

type DashEvidence = { type: "static" | "dynamic"; representations: Array<{ id: string; contentType: "video" | "audio" | "unknown"; width?: number; height?: number; bandwidth?: number; codecs?: string; segmentCount: number }>; limitations: string[]; analysis?: unknown };
type ReportedEvidence = { approximateTimeSeconds?: number };
function DashForensics({ evidence, reported }: { evidence: DashEvidence; reported?: ReportedEvidence }): JSX.Element {
  const analysis = asDashAnalysis(evidence.analysis);
  return (
    <section className="animate-fade-up rounded-3xl border border-sky-300/15 bg-sky-300/[0.035] p-6 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">DASH forensic boundary</p>
      <h3 className="mt-2 text-lg font-semibold tracking-tight">Candidate switching evidence</h3>
      <p className="mt-2 text-sm leading-6 text-harness-muted">
        {reported?.approximateTimeSeconds !== undefined
          ? `The user-reported time (${formatSeconds(reported.approximateTimeSeconds)}) selected the primary window. It is a hypothesis, not player telemetry.`
          : "No precise incident time was available in the report. These are representative candidate boundaries, not a recorded player switch."}
      </p>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-white/40"><tr><th className="pb-3 pr-4">Representation</th><th className="pb-3 pr-4">Resolution</th><th className="pb-3 pr-4">Bandwidth</th><th className="pb-3 pr-4">Codec</th><th className="pb-3">Segments</th></tr></thead><tbody>{evidence.representations.filter((entry) => entry.contentType === "video").map((entry) => <tr className="border-t border-white/[0.07] text-white/75" key={entry.id}><td className="py-3 pr-4 font-mono text-xs">{entry.id}</td><td className="py-3 pr-4">{entry.width && entry.height ? `${entry.width}×${entry.height}` : "—"}</td><td className="py-3 pr-4">{entry.bandwidth ? `${Math.round(entry.bandwidth / 1000)} kbps` : "—"}</td><td className="py-3 pr-4">{entry.codecs ?? "—"}</td><td className="py-3">{entry.segmentCount}</td></tr>)}</tbody></table></div>
      {analysis && <div className="mt-6 grid gap-3 lg:grid-cols-2">{analysis.matrix.map((entry) => <article className="rounded-2xl border border-white/[0.08] bg-black/20 p-4" key={entry.sequence}><div className="flex items-center justify-between gap-3"><p className="font-mono text-xs text-white/80">{entry.sequence}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${entry.structuralResult === "pass" ? "bg-emerald-300/15 text-emerald-200" : entry.structuralResult === "fail" ? "bg-rose-300/15 text-rose-200" : "bg-amber-300/15 text-amber-100"}`}>{entry.structuralResult}</span></div><p className="mt-2 text-sm leading-6 text-harness-muted">{entry.interpretation}</p><p className="mt-2 text-xs text-white/35">Decoder sequence: not run — structural evidence only.</p></article>)}</div>}
      {evidence.limitations.length > 0 && <p className="mt-5 text-xs leading-5 text-white/40">{evidence.limitations.join(" ")}</p>}
    </section>
  );
}

function getDashEvidence(evidence: unknown): { evidence: DashEvidence; reported?: ReportedEvidence } | undefined {
  if (!evidence || typeof evidence !== "object") return undefined;
  const candidate = evidence as { dash?: unknown; reportedContext?: unknown };
  const dash = candidate.dash;
  if (!dash || typeof dash !== "object" || !Array.isArray((dash as { representations?: unknown }).representations)) return undefined;
  const typed = dash as DashEvidence;
  return { evidence: typed, ...(candidate.reportedContext && typeof candidate.reportedContext === "object" ? { reported: candidate.reportedContext as ReportedEvidence } : {}) };
}

type DashAnalysis = { matrix: Array<{ sequence: string; structuralResult: "pass" | "warning" | "fail" | "indeterminate"; interpretation: string }> };
function asDashAnalysis(value: unknown): DashAnalysis | undefined {
  if (!value || typeof value !== "object" || !Array.isArray((value as { matrix?: unknown }).matrix)) return undefined;
  const matrix = (value as { matrix: unknown[] }).matrix.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { sequence?: unknown; structuralResult?: unknown; interpretation?: unknown };
    return typeof item.sequence === "string" && typeof item.interpretation === "string" && ["pass", "warning", "fail", "indeterminate"].includes(String(item.structuralResult)) ? [{ sequence: item.sequence, structuralResult: item.structuralResult as DashAnalysis["matrix"][number]["structuralResult"], interpretation: item.interpretation }] : [];
  });
  return { matrix };
}
function formatSeconds(value: number): string { const hours = Math.floor(value / 3600); const minutes = Math.floor((value % 3600) / 60); const seconds = Math.floor(value % 60); return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`; }

function VerdictCard({
  content,
  ai,
  createdAt,
}: {
  content: EvidenceContent;
  ai?: AiLayer;
  createdAt: string;
}): JSX.Element {
  const confidence = ai?.confidence;
  const tone = confidence !== undefined ? confidenceTone(confidence) : undefined;

  return (
    <div className="gradient-ring animate-fade-up rounded-3xl shadow-card">
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Investigation complete
          </span>
          <span className="text-xs text-white/35">{formatDateTime(createdAt)}</span>
        </div>

        <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
              {content.title}
            </h2>
            <p className="mt-3 max-w-2xl text-pretty text-[15px] leading-7 text-white/70">
              {ai?.summary ?? content.summary}
            </p>
          </div>
          {confidence !== undefined && tone && (
            <div className="flex shrink-0 items-center gap-4 rounded-2xl border border-white/[0.08] bg-black/20 px-5 py-4">
              <ConfidenceRing value={confidence} />
              <div>
                <p className={`text-2xl font-semibold tabular-nums ${tone.text}`}>
                  {Math.round(confidence * 100)}
                  <span className="text-base font-medium">%</span>
                </p>
                <p className="mt-0.5 text-xs text-white/45">{tone.label}</p>
              </div>
            </div>
          )}
        </div>

        {ai?.likelyCause && (
          <div className="mt-6 flex items-start gap-4 rounded-2xl border border-violet-300/15 bg-violet-300/[0.05] p-5">
            <AgentAvatar persona={personaForSpecialist("lead-investigator")} />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-200/70">
                Lead investigator · likely cause
              </p>
              <p className="mt-2 text-pretty text-sm leading-6 text-white/85">{ai.likelyCause}</p>
            </div>
          </div>
        )}

        {!ai && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
              Confidence · {content.confidence.level.replace("_", " ")}
            </p>
            <p className="mt-2 text-sm leading-6 text-harness-muted">{content.confidence.explanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfidenceRing({ value }: { value: number }): JSX.Element {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const tone = confidenceTone(value);
  return (
    <svg aria-hidden="true" className="-rotate-90" height="72" viewBox="0 0 72 72" width="72">
      <circle cx="36" cy="36" fill="none" r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        fill="none"
        r={radius}
        stroke={tone.stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, value)))}
        strokeLinecap="round"
        strokeWidth="7"
        style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </svg>
  );
}

/* ========================== Recommendations ========================== */

function Recommendations({ recommendations }: { recommendations: string[] }): JSX.Element {
  return (
    <section className="animate-fade-up">
      <h3 className="text-lg font-semibold tracking-tight">What to do next</h3>
      <p className="mt-1 text-sm text-white/45">Recommended follow-ups, in order of impact.</p>
      <ol className="mt-5 grid gap-3 lg:grid-cols-2">
        {recommendations.map((recommendation, index) => (
          <li
            className="flex gap-4 rounded-2xl border border-white/[0.07] bg-harness-panel/70 p-5 transition-colors hover:border-white/15"
            key={recommendation.slice(0, 48)}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400/25 to-violet-400/25 text-sm font-semibold text-sky-200">
              {index + 1}
            </span>
            <p className="text-pretty text-sm leading-6 text-white/80">{recommendation}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ============================= Findings ============================= */

function Findings({ attention, observed }: { attention: AiFinding[]; observed: AiFinding[] }): JSX.Element {
  return (
    <section className="animate-fade-up">
      <h3 className="text-lg font-semibold tracking-tight">What the team found</h3>
      <p className="mt-1 text-sm text-white/45">
        {attention.length > 0
          ? `${attention.length} finding${attention.length === 1 ? "" : "s"} need attention · ${observed.length} neutral observation${observed.length === 1 ? "" : "s"}.`
          : "Everything observed is informational — nothing demands immediate action."}
      </p>

      {attention.length > 0 && (
        <div className="mt-5 space-y-3">
          {attention.map((finding) => (
            <FindingCard finding={finding} key={finding.title} open />
          ))}
        </div>
      )}

      {observed.length > 0 && (
        <details className="group mt-4 rounded-2xl border border-white/[0.07] bg-harness-panel/50">
          <summary className="flex cursor-pointer items-center gap-3 p-5 text-sm font-medium text-white/70 transition hover:text-white">
            <span className="disclosure-chevron text-white/35">▾</span>
            {observed.length} neutral observation{observed.length === 1 ? "" : "s"} from the specialists
          </summary>
          <div className="space-y-3 px-5 pb-5">
            {observed.map((finding) => (
              <FindingCard compact finding={finding} key={finding.title} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function FindingCard({
  finding,
  open = false,
  compact = false,
}: {
  finding: AiFinding;
  open?: boolean;
  compact?: boolean;
}): JSX.Element {
  const severity = SEVERITY_STYLES[finding.severity];
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${severity.dot}`} />
        <p className="text-sm font-semibold text-white/90">{finding.title}</p>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${severity.chip}`}>
          {severity.label}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-white/35">
          <ConfidenceMeter severity={finding.severity} value={finding.confidence} />
          {finding.evidenceIds.length > 0 && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
              {finding.evidenceIds.length} evidence ref{finding.evidenceIds.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </div>
      <p className={`text-pretty text-sm leading-6 text-white/70 ${compact ? "mt-2" : "mt-2.5"}`}>
        {finding.explanation}
      </p>
    </>
  );

  if (compact) {
    return <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">{body}</div>;
  }

  return (
    <details
      className={`rounded-2xl border p-5 ${
        finding.severity === "error"
          ? "border-rose-300/20 bg-rose-300/[0.04]"
          : finding.severity === "warning"
            ? "border-amber-300/15 bg-amber-300/[0.03]"
            : "border-white/[0.07] bg-harness-panel/70"
      }`}
      open={open}
    >
      {body}
    </details>
  );
}

function ConfidenceMeter({ value, severity }: { value: number; severity: Severity }): JSX.Element {
  const color =
    severity === "error" ? "bg-rose-400" : severity === "warning" ? "bg-amber-400" : "bg-sky-400";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confidence ${Math.round(value * 100)}%`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-white/10">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="tabular-nums">{Math.round(value * 100)}%</span>
    </span>
  );
}

/* ============================ Agent roster ============================ */

const AGENT_STATE_META: Record<AiLayer["agents"][number]["state"], { label: string; chip: string }> = {
  completed: { label: "Finished", chip: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200" },
  failed: { label: "Failed", chip: "border-rose-300/25 bg-rose-300/10 text-rose-200" },
  unavailable: { label: "Unavailable", chip: "border-white/15 bg-white/[0.05] text-white/50" },
};

function AgentRoster({ agents }: { agents: AiLayer["agents"] }): JSX.Element {
  return (
    <section className="animate-fade-up">
      <h3 className="text-lg font-semibold tracking-tight">Meet the team</h3>
      <p className="mt-1 text-sm text-white/45">Each specialist read the same evidence from a different angle.</p>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {agents.map((agent) => {
          const persona = personaForSpecialist(agent.id);
          const state = AGENT_STATE_META[agent.state];
          return (
            <article
              className="rounded-2xl border border-white/[0.07] bg-harness-panel/70 p-5 transition-colors hover:border-white/15"
              key={agent.id}
            >
              <div className="flex items-center gap-3.5">
                <AgentAvatar persona={persona} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white/90">{persona.name}</p>
                  <p className="text-xs text-white/45">{persona.role}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${state.chip}`}>
                  {state.label}
                </span>
              </div>
              {agent.summary && (
                <p className="mt-3.5 text-pretty text-[13px] leading-6 text-white/65">{agent.summary}</p>
              )}
              {agent.limitation && (
                <p className="mt-3.5 text-pretty text-[13px] leading-6 text-amber-200/70">{agent.limitation}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ========================= Evidence & limits ========================= */

function EvidenceDetails({ content }: { content: EvidenceContent }): JSX.Element {
  const evidence = content.evidence;
  const isV2 = "manifests" in evidence;
  return (
    <details className="group animate-fade-up rounded-2xl border border-white/[0.07] bg-harness-panel/50">
      <summary className="flex cursor-pointer items-center gap-3 p-5 text-sm font-semibold text-white/75 transition hover:text-white">
        <span className="disclosure-chevron text-white/35">▾</span>
        Deterministic evidence
        <span className="ml-auto text-xs font-normal text-white/35">
          {isV2
            ? `${evidence.manifests.length} manifests · ${evidence.mediaSamples.length} media samples`
            : "1 manifest"}
        </span>
      </summary>
      <div className="space-y-6 border-t border-white/[0.06] p-5 sm:p-6">
        <EvidenceRow label="Source">
          <span className="break-all font-mono text-xs text-white/60">{evidence.source.finalUrl}</span>
          <span className="mt-1 block text-xs text-white/40">
            {evidence.source.protocol.toUpperCase()} · HTTP {evidence.source.httpStatus}
          </span>
        </EvidenceRow>

        {content.findings.length > 0 && (
          <EvidenceRow label={`Deterministic checks (${content.findings.length})`}>
            <ul className="space-y-2">
              {content.findings.map((finding) => (
                <li className="flex items-start gap-2.5 text-sm" key={finding.title}>
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      finding.status === "limitation" ? "bg-amber-400" : "bg-sky-400"
                    }`}
                  />
                  <span className="text-white/65">
                    <span className="font-medium text-white/85">{finding.title}.</span> {finding.explanation}
                  </span>
                </li>
              ))}
            </ul>
          </EvidenceRow>
        )}

        {isV2 && evidence.manifests.length > 0 && (
          <EvidenceRow label="Manifests preserved">
            <ul className="space-y-1.5 font-mono text-xs text-white/60">
              {evidence.manifests.map((manifest) => (
                <li className="flex flex-wrap items-baseline gap-x-3" key={manifest.logicalKey}>
                  <span className="text-white/80">{manifest.logicalKey}</span>
                  <span>{manifest.kind}</span>
                  <span>{formatBytes(manifest.sizeBytes)}</span>
                  {typeof manifest.segmentCount === "number" && <span>{manifest.segmentCount} segments</span>}
                  {typeof manifest.variantCount === "number" && <span>{manifest.variantCount} variants</span>}
                </li>
              ))}
            </ul>
          </EvidenceRow>
        )}

        {isV2 && evidence.mediaSamples.length > 0 && (
          <EvidenceRow label="Media samples">
            <ul className="space-y-1.5 font-mono text-xs text-white/60">
              {evidence.mediaSamples.map((sample) => (
                <li className="flex flex-wrap items-baseline gap-x-3" key={sample.logicalKey}>
                  <span className="text-white/80">{sample.logicalKey}</span>
                  <span>{formatBytes(sample.sizeBytes)}</span>
                  {sample.probe?.format && <span>{sample.probe.format}</span>}
                  {sample.probe && sample.probe.tracks.length > 0 && (
                    <span>
                      {sample.probe.tracks
                        .map((track) => [track.kind, track.codec].filter(Boolean).join(" "))
                        .join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </EvidenceRow>
        )}
      </div>
    </details>
  );
}

function EvidenceRow(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{props.label}</p>
      <div className="mt-2.5">{props.children}</div>
    </div>
  );
}

function Limitations({ content, ai }: { content: EvidenceContent; ai?: AiLayer }): JSX.Element | null {
  const limitations = [...(ai?.limitations ?? []), ...content.evidence.limitations];
  if (limitations.length === 0) return null;
  return (
    <section className="animate-fade-up rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-white/75">What this report does not prove</h3>
      <ul className="mt-3 space-y-2">
        {limitations.map((limitation) => (
          <li className="flex items-start gap-2.5 text-sm leading-6 text-white/55" key={limitation.slice(0, 64)}>
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/30" />
            {limitation}
          </li>
        ))}
      </ul>
    </section>
  );
}
