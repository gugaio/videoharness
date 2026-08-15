import type { InvestigationReport } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { AgentAvatar, personaForSpecialist } from "./agents";

type ReportContent = InvestigationReport["content"];
type EvidenceContent = Extract<ReportContent, { placeholder: false }>;
type AiLayer = NonNullable<EvidenceContent["ai"]>;
type AiFinding = AiLayer["findings"][number];

export function InvestigationReportView({ report, onValidate, onInspectEvidence }: {
  report: InvestigationReport;
  onValidate?(): void;
  onInspectEvidence?(): void;
}): JSX.Element {
  return (
    <section className="scroll-mt-6 border-t border-slate-200 bg-white" id="report">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        {report.content.placeholder
          ? <PlaceholderReport content={report.content} createdAt={report.createdAt} />
          : <EvidenceReport content={report.content} createdAt={report.createdAt} onInspectEvidence={onInspectEvidence} onValidate={onValidate} />}
      </div>
    </section>
  );
}

function PlaceholderReport({ content, createdAt }: {
  content: Extract<ReportContent, { placeholder: true }>;
  createdAt: string;
}): JSX.Element {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
      <ReportHeading createdAt={createdAt} placeholder />
      <h2 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">{content.title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{content.summary}</p>
      <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        {content.confidence.explanation}
      </p>
    </div>
  );
}

function EvidenceReport({ content, createdAt, onValidate, onInspectEvidence }: {
  content: EvidenceContent;
  createdAt: string;
  onValidate?(): void;
  onInspectEvidence?(): void;
}): JSX.Element {
  const ai = content.ai?.available ? content.ai : undefined;
  const attention = ai?.findings.filter((finding) => finding.severity !== "info") ?? [];
  const observations = ai?.findings.filter((finding) => finding.severity === "info") ?? [];
  const limitations = unique([...(ai?.limitations ?? []), ...content.evidence.limitations]);

  return (
    <div>
      <ReportHeading createdAt={createdAt} />

      <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.10),transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
        <div className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Final conclusion</p>
              <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-3xl">Diagnosis complete</h2>
              <p className="mt-4 max-w-4xl text-pretty text-sm leading-7 text-slate-600 sm:text-[15px]">
                {ai?.summary ?? content.summary}
              </p>
            </div>
            {ai?.confidence !== undefined && <ConfidenceGauge value={ai.confidence} />}
          </div>

          {ai?.likelyCause && (
            <div className="mt-7 flex items-start gap-4 rounded-2xl border border-violet-200 bg-violet-50/80 p-5">
              <AgentAvatar persona={personaForSpecialist("lead-investigator")} />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Lead investigator · likely cause</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-800">{ai.likelyCause}</p>
              </div>
            </div>
          )}

          {(onValidate || onInspectEvidence) && (
            <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Optional next step</p>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">Validate the likely cause with a controlled replay.</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">The next stage creates CONTROL and one bounded treatment, while keeping the same permanent device URL.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {onInspectEvidence && <button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onInspectEvidence} type="button">Inspect stream data</button>}
                {onValidate && <button className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700" onClick={onValidate} type="button">Validate likely cause</button>}
              </div>
            </div>
          )}

          {!ai && (
            <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">Confidence · {content.confidence.level}</p>
              <p className="mt-2 text-sm leading-6 text-amber-900">{content.confidence.explanation}</p>
            </div>
          )}
        </div>
      </div>

      {ai && ai.recommendations.length > 0 && <Recommendations recommendations={ai.recommendations} />}
      {ai && ai.findings.length > 0 && <Findings attention={attention} observations={observations} />}

      <details className="group mt-8 rounded-2xl border border-slate-200 bg-slate-50/80">
        <summary className="flex cursor-pointer items-center gap-3 p-5 text-sm font-semibold text-slate-800">
          <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
          Deterministic checks
          <span className="ml-auto text-xs font-normal text-slate-400">{content.findings.length} findings</span>
        </summary>
        <div className="space-y-3 border-t border-slate-200 p-5">
          {content.findings.map((finding, index) => (
            <article className="rounded-xl border border-slate-200 bg-white p-4" key={`${finding.title}-${index}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${finding.status === "limitation" ? "bg-amber-400" : "bg-sky-500"}`} />
                <h3 className="text-sm font-semibold text-slate-900">{finding.title}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${finding.status === "limitation" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
                  {finding.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{finding.explanation}</p>
            </article>
          ))}
        </div>
      </details>

      {limitations.length > 0 && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">What this report does not prove</p>
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {limitations.map((limitation) => (
              <li className="flex gap-3 text-sm leading-6 text-slate-600" key={limitation}>
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-slate-400" />
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReportHeading({ createdAt, placeholder = false }: { createdAt: string; placeholder?: boolean }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Final report</p>
        <p className="mt-1 text-xs text-slate-500">The shareable conclusion from the preserved evidence and agent analysis.</p>
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${placeholder ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${placeholder ? "bg-amber-400" : "bg-emerald-500"}`} />
          {placeholder ? "Technical placeholder" : "Report ready"}
        </span>
        <span>{formatDateTime(createdAt)}</span>
      </div>
    </div>
  );
}

function ConfidenceGauge({ value }: { value: number }): JSX.Element {
  const percent = Math.round(value * 100);
  const tone = value >= 0.85
    ? { label: "High confidence", color: "#059669", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" }
    : value >= 0.65
      ? { label: "Moderate confidence", color: "#d97706", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" }
      : { label: "Limited confidence", color: "#e11d48", text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" };
  const circumference = 2 * Math.PI * 27;
  return (
    <div className={`flex flex-none items-center gap-3 rounded-2xl border px-4 py-3 ${tone.bg} ${tone.border}`}>
      <svg aria-hidden="true" className="-rotate-90" height="62" viewBox="0 0 62 62" width="62">
        <circle cx="31" cy="31" fill="none" r="27" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="31" cy="31" fill="none" r="27" stroke={tone.color} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value)} strokeLinecap="round" strokeWidth="6" />
      </svg>
      <div>
        <p className={`text-xl font-semibold tabular-nums ${tone.text}`}>{percent}%</p>
        <p className="mt-0.5 whitespace-nowrap text-[11px] text-slate-500">{tone.label}</p>
      </div>
    </div>
  );
}

function Recommendations({ recommendations }: { recommendations: string[] }): JSX.Element {
  return (
    <section className="mt-8">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700">Recommended actions</p>
      <h3 className="mt-1 text-lg font-semibold text-slate-950">What to do next</h3>
      <ol className="mt-4 grid gap-3 lg:grid-cols-2">
        {recommendations.map((recommendation, index) => (
          <li className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={`${recommendation}-${index}`}>
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-sky-100 text-sm font-semibold text-sky-800">{index + 1}</span>
            <p className="text-sm leading-6 text-slate-700">{recommendation}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Findings({ attention, observations }: { attention: AiFinding[]; observations: AiFinding[] }): JSX.Element {
  return (
    <section className="mt-8">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-700">Evidence-linked findings</p>
      <h3 className="mt-1 text-lg font-semibold text-slate-950">What the team found</h3>
      <div className="mt-4 space-y-3">
        {attention.map((finding, index) => <FindingCard finding={finding} key={`${finding.title}-${index}`} />)}
      </div>
      {observations.length > 0 && (
        <details className="group mt-3 rounded-2xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer items-center gap-3 p-5 text-sm font-semibold text-slate-700">
            <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
            {observations.length} neutral observation{observations.length === 1 ? "" : "s"}
          </summary>
          <div className="space-y-3 border-t border-slate-200 p-5">
            {observations.map((finding, index) => <FindingCard finding={finding} key={`${finding.title}-${index}`} />)}
          </div>
        </details>
      )}
    </section>
  );
}

function FindingCard({ finding }: { finding: AiFinding }): JSX.Element {
  const style = finding.severity === "error"
    ? { border: "border-rose-200", bg: "bg-rose-50/60", dot: "bg-rose-500", chip: "bg-rose-100 text-rose-800", label: "Critical" }
    : finding.severity === "warning"
      ? { border: "border-amber-200", bg: "bg-amber-50/60", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800", label: "Needs attention" }
      : { border: "border-sky-200", bg: "bg-sky-50/50", dot: "bg-sky-500", chip: "bg-sky-100 text-sky-800", label: "Observed" };
  return (
    <article className={`rounded-2xl border p-5 ${style.border} ${style.bg}`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
        <h4 className="text-sm font-semibold text-slate-900">{finding.title}</h4>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.chip}`}>{style.label}</span>
        <span className="ml-auto text-[11px] font-medium tabular-nums text-slate-400">{Math.round(finding.confidence * 100)}% confidence</span>
      </div>
      <p className="mt-2.5 text-sm leading-6 text-slate-600">{finding.explanation}</p>
      {finding.evidenceIds.length > 0 && <p className="mt-3 text-[11px] text-slate-400">{finding.evidenceIds.length} linked evidence reference{finding.evidenceIds.length === 1 ? "" : "s"}</p>}
    </article>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
