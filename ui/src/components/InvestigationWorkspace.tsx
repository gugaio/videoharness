import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  askInvestigationQuestion,
  getInvestigationAiRuns,
  startInvestigationAnalysis,
  type AiPromptAudit,
  type Investigation,
  type InvestigationEvent,
  type InvestigationEvidence,
  type InvestigationReport,
} from "../lib/api";
import { AgentAvatar, personaForSpecialist } from "./agents";
import { DeterministicStreamExplorer } from "./DeterministicStreamExplorer";
import { InvestigationExperiments } from "./InvestigationExperiments";
import { InvestigationReportView } from "./InvestigationReport";

const agentIds = [
  "manifest-delivery",
  "container-encoding",
  "timeline-playback",
  "abr-switch-investigator",
  "lead-investigator",
] as const;

type AgentId = (typeof agentIds)[number];
export type InvestigationWorkspaceView = "evidence" | "analysis" | "validate";

export function InvestigationWorkspace(props: {
  investigation: Investigation;
  evidence?: InvestigationEvidence;
  report?: InvestigationReport;
  reportError?: Error | null;
  reportLoading?: boolean;
  events: InvestigationEvent[];
  connected: boolean;
  view: InvestigationWorkspaceView;
  onViewChange(view: InvestigationWorkspaceView): void;
}): JSX.Element {
  const { investigation, report, events, connected, view, onViewChange } = props;
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("lead-investigator");
  const queryClient = useQueryClient();
  const persistedAnalysis = ["analysis_queued", "analyzing", "synthesizing", "completed"].includes(investigation.state);
  const startAnalysis = useMutation({
    mutationFn: () => startInvestigationAnalysis(investigation.id),
    onSuccess: async () => {
      onViewChange("analysis");
      await queryClient.invalidateQueries({ queryKey: ["investigation", investigation.id] });
    },
  });
  const analysisAvailable = persistedAnalysis || startAnalysis.isSuccess;
  const validationAvailable = investigation.state === "completed" && Boolean(report && !report.content.placeholder);
  const activeView: InvestigationWorkspaceView = view === "validate"
    ? validationAvailable ? "validate" : analysisAvailable ? "analysis" : "evidence"
    : view === "analysis" && analysisAvailable ? "analysis" : "evidence";
  const audits = useQuery({
    queryKey: ["investigation-ai-runs", investigation.id],
    queryFn: () => getInvestigationAiRuns(investigation.id),
    enabled: analysisAvailable,
    refetchInterval: investigation.state === "analyzing" || investigation.state === "synthesizing" ? 2_000 : false,
  });
  const evidence = props.evidence ?? richEvidence(report);

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200/90 bg-[#f7f7fb] text-slate-700 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
      <WorkspaceHeader
        analysisAvailable={analysisAvailable}
        connected={connected}
        evidence={evidence}
        investigation={investigation}
        onViewChange={onViewChange}
        validationAvailable={validationAvailable}
        view={activeView}
      />
      {activeView === "evidence" ? (
        <main className="min-h-[680px] bg-[#f8f8fb]">
          {evidence ? (
            <DeterministicStreamExplorer evidence={evidence} />
          ) : (
            <EmptyEvidence connected={connected} events={events} investigation={investigation} />
          )}
          <AnalysisCta
            analysisAvailable={analysisAvailable}
            error={startAnalysis.error}
            evidenceReady={Boolean(evidence) && investigation.state === "evidence_ready"}
            isPending={startAnalysis.isPending}
            onOpen={() => analysisAvailable ? onViewChange("analysis") : startAnalysis.mutate()}
          />
        </main>
      ) : activeView === "validate" && report && !report.content.placeholder ? (
        <InvestigationExperiments investigationId={investigation.id} report={report} />
      ) : (
        <>
          {report
            ? (
              <>
                <InvestigationReportView
                  onInspectEvidence={() => onViewChange("evidence")}
                  onValidate={() => onViewChange("validate")}
                  report={report}
                />
                <AnalysisAudit
                  audits={audits.data}
                  events={events}
                  investigationId={investigation.id}
                  onSelect={setSelectedAgent}
                  report={report}
                  selectedAgent={selectedAgent}
                />
              </>
            ) : investigation.state === "completed" ? (
              <ReportPending error={props.reportError} loading={props.reportLoading} state={investigation.state} />
            ) : (
              <>
                <LiveAnalysis
                  audits={audits.data}
                  events={events}
                  investigationId={investigation.id}
                  onSelect={setSelectedAgent}
                  report={report}
                  selectedAgent={selectedAgent}
                />
                <ReportPending error={props.reportError} loading={props.reportLoading} state={investigation.state} />
              </>
            )}
        </>
      )}
    </section>
  );
}

function LiveAnalysis(props: {
  events: InvestigationEvent[];
  investigationId: string;
  report?: InvestigationReport;
  audits?: AiPromptAudit[];
  selectedAgent: AgentId;
  onSelect(agent: AgentId): void;
}): JSX.Element {
  return (
    <div className="grid min-h-[680px] xl:grid-cols-[250px_minmax(0,1fr)]">
      <AgentRail events={props.events} onSelect={props.onSelect} report={props.report} selectedAgent={props.selectedAgent} />
      <main className="min-w-0 border-t border-slate-200 bg-[#f8f8fb] xl:border-l xl:border-t-0">
        <AgentAuditInspector audits={props.audits} selectedAgent={props.selectedAgent} />
        <ActivityTimeline events={props.events} />
        <QuestionComposer investigationId={props.investigationId} />
      </main>
    </div>
  );
}

function AnalysisAudit(props: {
  events: InvestigationEvent[];
  investigationId: string;
  report: InvestigationReport;
  audits?: AiPromptAudit[];
  selectedAgent: AgentId;
  onSelect(agent: AgentId): void;
}): JSX.Element {
  const activityCount = props.events.filter(isAnalysisEvent).length;
  return (
    <details className="group border-t border-slate-200 bg-[#f8f8fb]" open>
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-5 sm:px-8">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition group-open:rotate-180">⌄</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">Agent panel</span>
          <span className="mt-0.5 block text-xs text-slate-500">Review each specialist run with the input packet received, its system prompt, tool results and validated output.</span>
        </span>
        <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 sm:inline">{activityCount} activities</span>
      </summary>
      <div className="grid border-t border-slate-200 xl:grid-cols-[250px_minmax(0,1fr)]">
        <AgentRail events={props.events} onSelect={props.onSelect} report={props.report} selectedAgent={props.selectedAgent} />
        <main className="min-w-0 border-t border-slate-200 bg-[#f8f8fb] xl:border-l xl:border-t-0">
          <AgentAuditInspector audits={props.audits} selectedAgent={props.selectedAgent} />
          <ActivityTimeline completed events={props.events} />
          <QuestionComposer investigationId={props.investigationId} />
        </main>
      </div>
    </details>
  );
}

function ReportPending({ error, loading, state }: {
  error?: Error | null;
  loading?: boolean;
  state: Investigation["state"];
}): JSX.Element {
  const failed = Boolean(error) || state === "failed";
  const completed = state === "completed";
  return (
    <section className="border-t border-slate-200 bg-white px-5 py-8 sm:px-8" id="report">
      <div className={`mx-auto max-w-6xl rounded-2xl border p-5 ${failed ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${failed ? "text-rose-700" : "text-slate-500"}`}>Final report</p>
        <h2 className="mt-2 text-base font-semibold text-slate-900">
          {failed ? "The final report could not be loaded." : completed || loading ? "Loading the completed report…" : "The report will appear here when synthesis finishes."}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {error?.message ?? (failed ? "Review the failed analysis event above for the persisted cause." : "This section is backed by the persisted report; it is not a simulated progress state.")}
        </p>
      </div>
    </section>
  );
}

function WorkspaceHeader({ investigation, connected, evidence, view, analysisAvailable, validationAvailable, onViewChange }: {
  investigation: Investigation;
  connected: boolean;
  evidence: RichEvidence | undefined;
  view: InvestigationWorkspaceView;
  analysisAvailable: boolean;
  validationAvailable: boolean;
  onViewChange(view: InvestigationWorkspaceView): void;
}): JSX.Element {
  const host = hostname(investigation.sourceUrl);
  const mediaChunkCount = evidence?.mediaSamples.filter((sample) => sample.kind === "media-segment").length;
  const initCount = evidence?.mediaSamples.filter((sample) => sample.kind === "init-segment").length;
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700">Investigation workspace</p>
          <p className="mt-1 truncate text-sm font-medium text-slate-800">{host}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          {evidence && <Pill>{evidence.source.protocol.toUpperCase()}</Pill>}
          {evidence && <Pill>{`${evidence.manifests.length} manifest${evidence.manifests.length === 1 ? "" : "s"}`}</Pill>}
          {mediaChunkCount !== undefined && <Pill>{`${mediaChunkCount} preserved chunk${mediaChunkCount === 1 ? "" : "s"}`}</Pill>}
          {initCount !== undefined && initCount > 0 && <Pill>{`${initCount} init`}</Pill>}
          <span className={`inline-flex items-center gap-1.5 text-slate-500 ${connected ? "" : "text-amber-700"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-300"}`} />
            {connected ? "Live" : "Reconnecting"}
          </span>
        </div>
      </div>
      <nav aria-label="Investigation stages" className="flex gap-2 border-t border-slate-100 px-5 py-2.5 sm:px-6">
        <StageButton active={view === "evidence"} label="Stream data" number="1" onClick={() => onViewChange("evidence")} />
        <StageButton active={view === "analysis"} disabled={!analysisAvailable} label="Diagnosis" number="2" onClick={() => onViewChange("analysis")} />
        <StageButton active={view === "validate"} disabled={!validationAvailable} label="Validate" number="3" optional onClick={() => onViewChange("validate")} />
      </nav>
    </header>
  );
}

function AgentRail({ report, events, selectedAgent, onSelect }: {
  report?: InvestigationReport;
  events: InvestigationEvent[];
  selectedAgent: AgentId;
  onSelect(agent: AgentId): void;
}): JSX.Element {
  const ai = report && !report.content.placeholder ? report.content.ai : undefined;
  return (
    <aside className="bg-[#fbfbfd] p-4 sm:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Agents</p>
      <div className="mt-3 space-y-1.5">
        {agentIds.map((id) => {
          const persona = personaForSpecialist(id);
          const run = ai?.agents.find((entry) => entry.id === id);
          const state = run?.state ?? liveAgentState(events, id);
          const active = selectedAgent === id;
          return (
            <button
              className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${active ? "bg-violet-100/80" : "hover:bg-slate-100"}`}
              key={id}
              onClick={() => onSelect(id)}
            >
              <AgentAvatar active={active && state !== "failed"} persona={persona} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-800">{persona.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{persona.role}</span>
              </span>
              <StatusDot state={state} />
            </button>
          );
        })}
      </div>
      <p className="mt-5 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-500">Select an agent to inspect the input packet it received, its system prompt, tool results and validated output.</p>
    </aside>
  );
}

function AgentAuditInspector({ audits, selectedAgent }: {
  audits?: AiPromptAudit[];
  selectedAgent: AgentId;
}): JSX.Element {
  const persona = personaForSpecialist(selectedAgent);
  const attempts = (audits ?? [])
    .filter((audit) => audit.agentId === selectedAgent)
    .sort((left, right) => left.attempt - right.attempt);
  return (
    <section className="px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <AgentAvatar persona={persona} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{persona.name}</p>
          <p className="text-xs text-slate-500">{persona.role}</p>
        </div>
        {attempts.length > 0 && <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">{attempts.length} persisted call{attempts.length === 1 ? "" : "s"}</span>}
      </div>
      {attempts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-500">
          No persisted run for this agent yet. The audit appears once the agent completes against the evidence snapshot.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-slate-400">What this agent received and produced: the input evidence packet, system prompt, tool results and validated output — never model reasoning.</p>
          <div className="mt-4 space-y-3">
            {attempts.map((audit) => (
              <article className="rounded-2xl border border-slate-200 bg-white p-4" key={`${audit.agentId}-${audit.attempt}`}>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-800">Attempt {audit.attempt}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${audit.state === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{audit.state}</span>
                  <span className="text-slate-400">{audit.provider}/{audit.model}</span>
                </div>

                {audit.packetMetrics && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-600">
                    <span className="rounded-full bg-slate-100 px-2 py-1">{formatAuditBytes(audit.packetMetrics.packetBytes)} input</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1">{audit.packetMetrics.evidenceIdCount} citeable facts</span>
                    <span className={`rounded-full px-2 py-1 ${audit.packetMetrics.sharedEvidenceIdCount === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {audit.packetMetrics.sharedEvidenceIdCount} shared · {Math.round(audit.packetMetrics.sharedEvidenceRatio * 100)}% overlap
                    </span>
                  </div>
                )}

                <AuditBlock label="Input · evidence packet" value={audit.prompt} />
                {selectedAgent === "manifest-delivery" && <ManifestContentSent prompt={audit.prompt} />}
                <AuditBlock label="System prompt" value={audit.systemPrompt} />

                {audit.toolNames.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Tools available</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {audit.toolNames.map((name) => (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600" key={name}>{name}</span>
                      ))}
                    </div>
                  </div>
                )}

                {audit.toolCalls.length > 0 && (
                  <details className="group mt-3 rounded-xl border border-slate-200">
                    <summary className="flex cursor-pointer items-center gap-2 p-3 text-xs font-semibold text-slate-700">
                      <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
                      Tool calls · {audit.toolCalls.length}
                    </summary>
                    <div className="space-y-3 border-t border-slate-200 p-3">
                      {audit.toolCalls.map((call, callIndex) => (
                        <div key={`${call.name}-${callIndex}`}>
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{call.name}</p>
                          <AuditBlock label="Tool input" value={call.input} />
                          <AuditBlock label="Result returned to the model" value={call.output} />
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {audit.output !== undefined && (
                  <AuditBlock
                    label="Validated output"
                    value={typeof audit.output === "string" ? audit.output : JSON.stringify(audit.output, null, 2)}
                  />
                )}
              </article>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-400">The audit preserves the input packet, tool calls and validated output; it never includes model reasoning.</p>
        </>
      )}
    </section>
  );
}

function AuditBlock({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <details className="group mt-3" open>
      <summary className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
        {label}
        <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">{value.length} chars</span>
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-[#fbfbfd] p-3 font-mono text-[11px] leading-5 text-slate-600">{value}</pre>
    </details>
  );
}

/** Extracts the raw manifest text that was actually sent inline to the
 * manifest-delivery specialist, so the panel proves what the agent received. */
function manifestContentsFromPacket(prompt: string): Array<{ logicalKey: string; content: string }> {
  try {
    const parsed = JSON.parse(prompt) as { evidence?: { manifests?: unknown } };
    const manifests = parsed.evidence?.manifests;
    if (!Array.isArray(manifests)) return [];
    return manifests.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const manifest = entry as { logicalKey?: unknown; content?: unknown };
      return typeof manifest.logicalKey === "string" && typeof manifest.content === "string"
        ? [{ logicalKey: manifest.logicalKey, content: manifest.content }]
        : [];
    });
  } catch {
    return [];
  }
}

function ManifestContentSent({ prompt }: { prompt: string }): JSX.Element {
  const manifests = manifestContentsFromPacket(prompt);
  if (manifests.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800">
        This historical run was captured before the inline manifest content was preserved; re-run the analysis on the current snapshot to include it.
      </p>
    );
  }
  return (
    <details className="group mt-3 rounded-xl border border-slate-200" open>
      <summary className="flex cursor-pointer items-center gap-2 p-3 text-xs font-semibold text-slate-700">
        <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
        Manifest content sent inline
        <span className="ml-auto text-[11px] font-normal text-slate-400">{manifests.length} manifest{manifests.length === 1 ? "" : "s"}</span>
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-3">
        {manifests.map((manifest) => (
          <div key={manifest.logicalKey}>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{manifest.logicalKey}</p>
            <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-[#fbfbfd] p-3 font-mono text-[11px] leading-5 text-slate-600">{manifest.content}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function AnalysisCta({ analysisAvailable, evidenceReady, isPending, error, onOpen }: {
  analysisAvailable: boolean;
  evidenceReady: boolean;
  isPending: boolean;
  error: Error | null;
  onOpen(): void;
}): JSX.Element {
  if (!analysisAvailable && !evidenceReady) return <></>;
  return (
    <section className="border-t border-slate-200 bg-white px-5 py-6 sm:px-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-emerald-50 p-5 sm:flex-row sm:items-center">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-violet-600 text-sm font-bold text-white shadow-sm">AI</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">The deterministic pass is ready.</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">Start the agents with this immutable evidence snapshot, or keep inspecting the stream before moving on.</p>
          {error && <p className="mt-2 text-xs text-rose-600">{error.message}</p>}
        </div>
        <button className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={isPending} onClick={onOpen} type="button">
          {isPending ? "Starting agents…" : analysisAvailable ? "Open agent analysis" : "Start agent analysis"}
        </button>
      </div>
    </section>
  );
}

function StageButton({ active, disabled = false, label, number, optional = false, onClick }: {
  active: boolean;
  disabled?: boolean;
  label: string;
  number: string;
  optional?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${active ? "bg-violet-100 text-violet-800" : disabled ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500"}`}>{number}</span>
      {label}
      {optional && <span className="hidden text-[9px] font-medium uppercase tracking-wide text-slate-400 sm:inline">optional</span>}
    </button>
  );
}

function ActivityTimeline({ events, completed = false }: { events: InvestigationEvent[]; completed?: boolean }): JSX.Element {
  const relevant = useMemo(() => events.filter(isAnalysisEvent).slice(-24), [events]);
  return (
    <section className="px-5 py-5 sm:px-6">
      <div className="flex items-baseline justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-700">Agent timeline</p><h2 className="mt-1 text-base font-semibold text-slate-900">{completed ? "How the diagnosis was produced" : "Analysis as it happens"}</h2></div><span className="text-xs text-slate-400">{relevant.length} activities</span></div>
      <div className="mt-4 space-y-2">
        {relevant.map((event) => <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" key={event.id}><div className="flex gap-2 text-[11px]"><span className="font-semibold text-slate-700">{event.actor}</span><span className="ml-auto text-slate-400">{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><p className="mt-1 text-xs leading-5 text-slate-600">{questionMessage(event) ?? event.message}</p></div>)}
        {relevant.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-500">Agent activity will appear here as each specialist starts and completes its analysis.</p>}
      </div>
    </section>
  );
}

function QuestionComposer({ investigationId }: { investigationId: string }): JSX.Element {
  const [question, setQuestion] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => askInvestigationQuestion(investigationId, question.trim()),
    onSuccess: async () => {
      setQuestion("");
      await client.invalidateQueries({ queryKey: ["investigation", investigationId] });
    },
  });
  return (
    <form className="border-t border-slate-200 bg-white p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); if (question.trim()) mutation.mutate(); }}>
      <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="investigation-question">Question for the next analysis</label>
      <div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-[#fbfbfd] px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400" id="investigation-question" onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. Compare the GOP boundary around the downshift" value={question} /><button className="rounded-xl bg-violet-600 px-3.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40" disabled={!question.trim() || mutation.isPending} type="submit">{mutation.isPending ? "Saving…" : "Save question"}</button></div>
      <p className="mt-2 text-[11px] text-slate-500">This saves a question in the case timeline. It does not contact a model now; a future explicit agent run can reference it.</p>
      {mutation.error && <p className="mt-2 text-xs text-rose-600">{mutation.error.message}</p>}
    </form>
  );
}

type CollectionStage = "root_manifest" | "variant_manifest" | "rendition_manifest" | "media_sample" | "media_probe";
type CollectionStepState = "complete" | "active" | "pending" | "failed";

const COLLECTION_STEPS = [
  { label: "Verify the source", detail: "Check access through the safe network boundary." },
  { label: "Read the stream map", detail: "Discover manifests, renditions and representations." },
  { label: "Preserve real media", detail: "Save a bounded set of chunks from the stream." },
  { label: "Inspect playback data", detail: "Measure codecs, timing and container structure." },
] as const;

const COLLECTION_STAGE_STEP: Record<CollectionStage, number> = {
  root_manifest: 0,
  variant_manifest: 1,
  rendition_manifest: 1,
  media_sample: 2,
  media_probe: 3,
};

function EmptyEvidence({ investigation, events, connected }: {
  investigation: Investigation;
  events: InvestigationEvent[];
  connected: boolean;
}): JSX.Element {
  const progressEvent = latestCollectionProgress(events);
  const collectionStage = collectionStageOf(progressEvent);
  const activeStep = activeCollectionStep(investigation.state, collectionStage);
  const failed = investigation.state === "failed";
  const limitationCount = events.filter((event) => event.type === "investigation.collection_limited").length;
  const currentMessage = collectionActivityMessage(investigation.state, progressEvent, events);

  return (
    <section className="relative isolate min-h-[680px] overflow-hidden px-5 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_10%,rgba(124,58,237,0.09),transparent_31%),radial-gradient(circle_at_88%_35%,rgba(14,165,233,0.08),transparent_28%)]" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-white/80 to-transparent" />

      <div className="mx-auto grid max-w-5xl items-start gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
        <div className="animate-fade-up pt-1 lg:pt-5">
          <div className={`inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-[11px] font-semibold shadow-sm ${failed ? "border-rose-200 text-rose-700" : "border-sky-200 text-sky-700"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${failed ? "bg-rose-500" : connected ? "animate-pulse-dot bg-sky-500" : "bg-amber-400"}`} />
            {failed ? "Evidence pass stopped" : "Investigation in progress"}
          </div>

          <h1 className="mt-6 max-w-xl text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl lg:text-[42px] lg:leading-[1.08]">
            {collectionHeadline(investigation.state, collectionStage)}
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
            The first pass measures the stream before any agent interprets it. You can inspect every preserved fact as soon as this pass finishes.
          </p>

          <div aria-live="polite" className={`mt-7 max-w-2xl rounded-2xl border bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.07)] sm:p-5 ${failed ? "border-rose-200" : "border-slate-200"}`}>
            <div className="flex items-start gap-4">
              <div className={`grid h-11 w-11 flex-none place-items-center rounded-xl ${failed ? "bg-rose-50 text-rose-600" : "bg-gradient-to-br from-sky-50 to-violet-100 text-violet-700"}`}>
                {failed ? <FailureIcon /> : <StreamScanIcon />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{failed ? "Needs attention" : "Now examining"}</p>
                  {!failed && <span className="flex gap-1" aria-hidden="true"><span className="h-1 w-1 animate-typing-dot rounded-full bg-violet-400" /><span className="h-1 w-1 animate-typing-dot rounded-full bg-violet-400 [animation-delay:150ms]" /><span className="h-1 w-1 animate-typing-dot rounded-full bg-violet-400 [animation-delay:300ms]" /></span>}
                </div>
                <p className="mt-1.5 text-sm font-medium leading-6 text-slate-800">{currentMessage}</p>
                {limitationCount > 0 && investigation.state === "collecting" && (
                  <p className="mt-2 text-xs leading-5 text-amber-700">
                    {limitationCount} collection limitation{limitationCount === 1 ? " was" : "s were"} recorded. The remaining checks are continuing.
                  </p>
                )}
              </div>
            </div>
          </div>

          {investigation.problemDescription && (
            <div className="mt-5 max-w-2xl border-l-2 border-violet-200 pl-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Reported issue</p>
              <p className="mt-1.5 text-sm leading-6 text-slate-600">{shorten(investigation.problemDescription, 220)}</p>
            </div>
          )}

          <div className="mt-8 flex items-center gap-3 text-xs text-slate-500">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700"><ShieldCheckIcon /></span>
            <span><strong className="font-semibold text-slate-700">Facts first.</strong> Agents stay paused until you choose to start the analysis.</span>
          </div>
        </div>

        <aside className="animate-fade-up rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 [animation-delay:90ms]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Evidence pass</p>
              <h2 className="mt-1.5 text-base font-semibold text-slate-900">Building the stream picture</h2>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{connected ? "Live updates" : "Syncing"}</span>
          </div>

          <ol className="mt-6">
            {COLLECTION_STEPS.map((step, index) => {
              const state = collectionStepState(index, activeStep, investigation.state);
              return (
                <li className="relative flex gap-3.5 pb-6 last:pb-0" key={step.label}>
                  {index < COLLECTION_STEPS.length - 1 && <span aria-hidden="true" className={`absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px ${state === "complete" ? "bg-emerald-200" : "bg-slate-200"}`} />}
                  <CollectionStepMarker index={index} state={state} />
                  <div className="min-w-0 pt-0.5">
                    <p className={`text-sm font-semibold ${state === "active" ? "text-violet-800" : state === "failed" ? "text-rose-700" : state === "complete" ? "text-slate-800" : "text-slate-400"}`}>{step.label}</p>
                    <p className={`mt-1 text-xs leading-5 ${state === "pending" ? "text-slate-400" : "text-slate-500"}`}>{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function CollectionStepMarker({ index, state }: { index: number; state: CollectionStepState }): JSX.Element {
  const className = state === "complete"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : state === "active"
      ? "border-violet-300 bg-violet-600 text-white shadow-[0_0_0_5px_rgba(139,92,246,0.09)]"
      : state === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-600"
        : "border-slate-200 bg-slate-50 text-slate-400";
  return (
    <span className={`relative z-10 grid h-7 w-7 flex-none place-items-center rounded-full border text-[10px] font-semibold ${className}`}>
      {state === "complete" ? <CheckIcon /> : state === "failed" ? "!" : state === "active" ? <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" /> : index + 1}
    </span>
  );
}

function latestCollectionProgress(events: InvestigationEvent[]): InvestigationEvent | undefined {
  return [...events].reverse().find((event) => event.payload.stage === "collection");
}

function collectionStageOf(event: InvestigationEvent | undefined): CollectionStage | undefined {
  const value = event?.payload.collectionStage;
  return value === "root_manifest" || value === "variant_manifest" || value === "rendition_manifest" || value === "media_sample" || value === "media_probe"
    ? value
    : undefined;
}

function activeCollectionStep(state: Investigation["state"], stage: CollectionStage | undefined): number {
  if (state === "queued" || state === "validating") return 0;
  if (state === "evidence_ready" || state === "analysis_queued" || state === "analyzing" || state === "synthesizing" || state === "completed") return COLLECTION_STEPS.length;
  if (state === "failed" && stage === undefined) return 0;
  return stage === undefined ? 0 : COLLECTION_STAGE_STEP[stage];
}

function collectionStepState(index: number, activeStep: number, investigationState: Investigation["state"]): CollectionStepState {
  if (index < activeStep) return "complete";
  if (index > activeStep || activeStep >= COLLECTION_STEPS.length) return activeStep >= COLLECTION_STEPS.length ? "complete" : "pending";
  return investigationState === "failed" ? "failed" : "active";
}

function collectionHeadline(state: Investigation["state"], stage: CollectionStage | undefined): string {
  if (state === "queued") return "Your investigation is ready to begin.";
  if (state === "validating") return "Checking this stream safely.";
  if (state === "failed") return "This evidence pass needs attention.";
  if (state === "evidence_ready" || state === "analysis_queued" || state === "analyzing" || state === "synthesizing" || state === "completed") return "Your stream evidence is ready.";
  if (stage === "media_sample") return "Preserving a real slice of the stream.";
  if (stage === "media_probe") return "Inspecting timing and encoding.";
  return "Mapping the stream from the source.";
}

function collectionActivityMessage(state: Investigation["state"], progressEvent: InvestigationEvent | undefined, events: InvestigationEvent[]): string {
  if (state === "queued") return "The case is open and waiting for an available worker.";
  if (state === "validating") return "Validating the destination before opening a network connection.";
  if (state === "evidence_ready" || state === "analysis_queued" || state === "analyzing" || state === "synthesizing" || state === "completed") return "The evidence is preserved. Opening the stream explorer now.";
  if (state === "failed") {
    return [...events].reverse().find((event) => event.type === "investigation.failed")?.message
      ?? "The worker could not finish this evidence pass. The case remains available for review.";
  }
  return progressEvent?.message ?? "Collecting manifests and a bounded set of media samples.";
}

function shorten(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

function formatAuditBytes(bytes: number): string {
  return bytes < 1_024 ? `${bytes} B` : `${(bytes / 1_024).toFixed(1)} KB`;
}

function StreamScanIcon(): JSX.Element {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M3.5 12h3l1.7-4.5 3.1 9 2.2-6 1.6 3.5h5.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /><path d="M5.5 5.5h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.4" /></svg>;
}

function ShieldCheckIcon(): JSX.Element {
  return <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><path d="M12 3 5.5 5.5v5.7c0 4.3 2.7 7.7 6.5 9.8 3.8-2.1 6.5-5.5 6.5-9.8V5.5L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" /><path d="m8.8 12 2 2 4.4-4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function CheckIcon(): JSX.Element {
  return <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16"><path d="m3.5 8.2 2.7 2.6 6.3-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function FailureIcon(): JSX.Element {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 8v5m0 3.5v.01M4.6 19h14.8a1.6 1.6 0 0 0 1.4-2.4L13.4 4a1.6 1.6 0 0 0-2.8 0L3.2 16.6A1.6 1.6 0 0 0 4.6 19Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function StatusDot({ state }: { state?: "running" | "completed" | "failed" | "unavailable" }): JSX.Element {
  const color = state === "completed" ? "bg-emerald-500" : state === "running" ? "animate-pulse bg-violet-500" : state === "failed" ? "bg-rose-500" : state === "unavailable" ? "bg-amber-400" : "bg-slate-300";
  return <span className={`h-2 w-2 rounded-full ${color}`} title={state ?? "waiting"} />;
}

function Pill({ children }: { children: string | number }): JSX.Element { return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600">{children}</span>; }

type RichEvidence = InvestigationEvidence;

function richEvidence(report?: InvestigationReport): RichEvidence | undefined {
  if (!report || report.content.placeholder) return undefined;
  const evidence = report.content.evidence;
  return evidence.schemaVersion === 2 || evidence.schemaVersion === 3 ? evidence : undefined;
}

function questionMessage(event: InvestigationEvent): string | undefined {
  if (event.type !== "investigation.question_asked") return undefined;
  return typeof event.payload.question === "string" ? event.payload.question : undefined;
}

function isAnalysisEvent(event: InvestigationEvent): boolean {
  return agentIds.some((agentId) => event.actor === agentId)
    || event.type === "investigation.analysis_requested"
    || event.type === "investigation.agent_runs_recorded"
    || event.type === "investigation.report_ready"
    || event.type === "investigation.question_asked"
    || event.type === "investigation.analysis_retry_scheduled"
    || event.type === "investigation.analysis_failed";
}

function liveAgentState(
  events: InvestigationEvent[],
  agentId: AgentId,
): "running" | "completed" | "failed" | undefined {
  const event = [...events].reverse().find((entry) => entry.payload.agent === agentId);
  const stage = event?.payload.agentStage;
  return stage === "started" ? "running" : stage === "completed" ? "completed" : stage === "failed" ? "failed" : undefined;
}

function hostname(value: string): string { try { return new URL(value).hostname; } catch { return value; } }
