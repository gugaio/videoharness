import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  activateExperimentTest,
  createExperiment,
  createExperimentIteration,
  createTestEnvironment,
  evaluateExperiment,
  getExperiment,
  listInvestigationExperiments,
  listTestEnvironments,
  previewCloneRecipe,
  queueExperimentClones,
  submitExperimentTestResult,
  type ExperimentDetail,
  type ExperimentTestRequest,
  type InvestigationReport,
} from "../lib/api";

const failureStages = [
  ["LOAD_MANIFEST", "Manifest load"], ["STARTUP", "Startup"], ["VIDEO_DECODE", "Video"], ["AUDIO_DECODE", "Audio"],
  ["DRM", "DRM"], ["STALL", "Stall"], ["ABR_SWITCH", "ABR switch"], ["SEEK", "Seek"], ["AV_SYNC", "A/V sync"],
  ["SUBTITLES", "Subtitles"], ["UNKNOWN", "Other"],
] as const;

export function InvestigationExperiments({ investigationId, report }: { investigationId: string; report: InvestigationReport }): JSX.Element {
  const draft = validationDraft(report);
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [goal, setGoal] = useState(draft.goal);
  const [hypothesis, setHypothesis] = useState(draft.hypothesis);
  const [rationale, setRationale] = useState(draft.rationale);
  const [environmentId, setEnvironmentId] = useState("");
  const [environmentName, setEnvironmentName] = useState("");
  const [environmentPlatform, setEnvironmentPlatform] = useState("");
  const [message, setMessage] = useState<string>();
  const [showCreator, setShowCreator] = useState(false);

  const summaries = useQuery({
    queryKey: ["experiments", investigationId], queryFn: () => listInvestigationExperiments(investigationId), refetchInterval: 4_000,
  });
  useEffect(() => {
    if (!selectedId && summaries.data?.[0]) setSelectedId(summaries.data[0].id);
  }, [selectedId, summaries.data]);
  const detail = useQuery({
    queryKey: ["experiment", selectedId], queryFn: () => getExperiment(selectedId!), enabled: Boolean(selectedId),
    refetchInterval: (query) => query.state.data && ["CONCLUDED", "FAILED", "CANCELLED"].includes(query.state.data.status) ? false : 2_000,
  });
  const environments = useQuery({ queryKey: ["test-environments"], queryFn: listTestEnvironments });

  const refresh = async (id?: string): Promise<void> => {
    await client.invalidateQueries({ queryKey: ["experiments", investigationId] });
    await client.invalidateQueries({ queryKey: ["experiment", id ?? selectedId] });
  };
  const createFlow = useMutation({
    mutationFn: async () => {
      if (!draft.treatment) throw new Error("The agent report does not contain a supported discriminating treatment. Run the analysis again or edit the diagnosis before creating a validation.");
      const control = await previewCloneRecipe({ recipe: "control", investigationId, shortLabel: "CONTROL", hypothesisIds: [] });
      const experiment = await createExperiment(investigationId, { goal, hypothesis, rationale, ...(environmentId ? { targetEnvironmentId: environmentId } : {}) });
      setSelectedId(experiment.id);
      const hypothesisId = experiment.hypotheses[0]!.id;
      const treatment = await previewCloneRecipe(treatmentPreviewInput(draft, investigationId, hypothesisId));
      const iteration = await createExperimentIteration(experiment.id, `CONTROL plus ${draft.treatment.shortLabel}: ${draft.proofBoundary}`, [control.spec, treatment.spec]);
      await queueExperimentClones(experiment.id, iteration.id);
      return experiment.id;
    },
    onSuccess: async (id) => { setSelectedId(id); setShowCreator(false); setMessage(`Experiment created. The worker is building and verifying CONTROL and ${draft.treatment?.shortLabel ?? "the treatment"}.`); await refresh(id); },
    onError: async (error) => { setMessage(error instanceof Error ? error.message : "Could not create the experiment."); await refresh(); },
  });
  const saveEnvironment = useMutation({
    mutationFn: () => createTestEnvironment({ name: environmentName, ...(environmentPlatform ? { platform: environmentPlatform } : {}) }),
    onSuccess: async (environment) => { setEnvironmentId(environment.id); setEnvironmentName(""); setEnvironmentPlatform(""); await client.invalidateQueries({ queryKey: ["test-environments"] }); },
  });

  return (
    <section className="min-h-[680px] bg-[#f8f8fb] px-5 py-8 sm:px-8 sm:py-10" aria-labelledby="experiments-title">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700">Validate · optional</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl" id="experiments-title">Test the diagnosis, not the whole stream</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Create a full-ladder CONTROL and one agent-designed bounded treatment, replay the same permanent URL, and record only what the device actually did.</p>
          </div>
        </div>

        {summaries.data && summaries.data.length > 0 && !showCreator && <button className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm hover:border-violet-300 hover:text-violet-700" onClick={() => setShowCreator(true)}>Start another controlled validation</button>}
        {(!summaries.data?.length || showCreator) && <>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <article className="rounded-3xl border border-violet-200 bg-gradient-to-br from-white to-violet-50/70 p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">{draft.source === "agent" ? "Agent-designed validation" : "Diagnosis-derived validation"}</p>
            <p className="mt-3 text-base font-semibold leading-7 text-slate-900">{draft.sourceConclusion}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">The experiment will persist the statement below as a real hypothesis. It is separate from report findings and can be supported or weakened by attributed device results.</p>
          </article>
          <article className="rounded-3xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">What this validation can prove</p>
            <p className="mt-3 text-sm leading-6 text-amber-950">{draft.proofBoundary}</p>
          </article>
        </div>

        <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {summaries.data && summaries.data.length > 0 && <div className="mb-4 flex justify-end"><button className="text-xs font-semibold text-slate-500 hover:text-slate-800" onClick={() => setShowCreator(false)}>Cancel new validation</button></div>}
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Hypothesis to test
            <textarea className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium normal-case leading-6 tracking-normal text-slate-800 outline-none focus:border-violet-400" value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Target environment
              <select className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm normal-case tracking-normal text-slate-800 outline-none focus:border-violet-400" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
                <option value="">Not specified</option>
                {environments.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.platform ? ` · ${entry.platform}` : ""}</option>)}
              </select>
            </label>
            <button className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40" disabled={createFlow.isPending || !draft.treatment || goal.trim().length < 3 || hypothesis.trim().length < 3} onClick={() => createFlow.mutate()}>
              {createFlow.isPending ? "Building validation…" : `Build CONTROL + ${draft.treatment?.shortLabel ?? "treatment"}`}
            </button>
          </div>
          <details className="group mt-5 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">Edit diagnostic goal and rationale</summary>
            <div className="mt-4 grid gap-4">
              <Field label="Diagnostic goal" value={goal} onChange={setGoal} />
              <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Rationale
                <textarea className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm normal-case leading-6 tracking-normal text-slate-800 outline-none focus:border-violet-400" value={rationale} onChange={(event) => setRationale(event.target.value)} />
              </label>
            </div>
          </details>
          <details className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">Save a device environment</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <input className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 outline-none focus:border-violet-400" placeholder="Living room TV" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} />
              <input className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 outline-none focus:border-violet-400" placeholder="Tizen 7 / webOS / Android TV" value={environmentPlatform} onChange={(event) => setEnvironmentPlatform(event.target.value)} />
              <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 disabled:opacity-40" disabled={!environmentName.trim() || saveEnvironment.isPending} onClick={() => saveEnvironment.mutate()}>Save</button>
            </div>
          </details>
          {message && <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">{message}</p>}
        </div>
        </>}

        {summaries.data && summaries.data.length > 0 && (
          <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
            {summaries.data.map((entry) => <button key={entry.id} className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${selectedId === entry.id ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-slate-600"}`} onClick={() => setSelectedId(entry.id)}>{entry.goal.slice(0, 42)} · {entry.status}</button>)}
          </div>
        )}
        {detail.data && <ExperimentPanel draft={draft} experiment={detail.data} onRefresh={() => refresh(detail.data.id)} />}
      </div>
    </section>
  );
}

function ExperimentPanel({ draft, experiment, onRefresh }: { draft: ValidationDraft; experiment: ExperimentDetail; onRefresh(): Promise<void> }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const requests = experiment.testRequests;
  const stablePath = requests[0]?.testUrl;
  const stableUrl = stablePath ? new URL(stablePath, window.location.href).toString() : undefined;
  const currentIteration = last(experiment.iterations);
  const latestEvaluation = last(experiment.evaluations);
  const previousIterations = experiment.iterations.slice(0, -1);
  const currentClones = experiment.clones.filter((entry) => entry.iterationId === currentIteration?.id);
  const currentRequests = requests.filter((entry) => entry.iterationId === currentIteration?.id);
  const tested = currentRequests.filter((entry) => entry.result).length;
  const evaluate = useMutation({ mutationFn: () => evaluateExperiment(experiment.id), onSuccess: onRefresh });
  const continueSetup = useMutation({
    mutationFn: async () => {
      if (experiment.status === "PLANNED" && currentIteration) {
        await queueExperimentClones(experiment.id, currentIteration.id);
        return;
      }
      const hypothesisId = experiment.hypotheses[0]?.id;
      if (experiment.status !== "DRAFT" || !hypothesisId) throw new Error("This experiment cannot resume its first iteration.");
      if (!draft.treatment) throw new Error("No supported agent-designed treatment is available for this diagnosis.");
      const [control, treatment] = await Promise.all([
        previewCloneRecipe({ recipe: "control", investigationId: experiment.investigationId, shortLabel: "CONTROL", hypothesisIds: [] }),
        previewCloneRecipe(treatmentPreviewInput(draft, experiment.investigationId, hypothesisId)),
      ]);
      const iteration = await createExperimentIteration(experiment.id, `CONTROL plus ${draft.treatment.shortLabel}: ${draft.proofBoundary}`, [control.spec, treatment.spec]);
      await queueExperimentClones(experiment.id, iteration.id);
    },
    onSuccess: onRefresh,
  });
  const allTested = currentRequests.length > 0 && tested === currentRequests.length;
  const evaluationRunning = experiment.evaluationJob?.status === "pending" || experiment.evaluationJob?.status === "running";
  const setupCanResume = experiment.status === "DRAFT" || (experiment.status === "PLANNED" && Boolean(currentIteration));
  const cloneCards = currentClones.map((clone) => {
    const request = currentRequests.find((entry) => entry.cloneId === clone.id);
    return request
      ? <TestCard key={clone.id} active={experiment.activeTestRequestId === request.id} clone={clone} experiment={experiment} request={request} onRefresh={onRefresh} />
      : <CloneBuildCard key={clone.id} clone={clone} />;
  });

  return (
    <article className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">{experiment.status}</p><h3 className="mt-2 text-xl font-semibold text-slate-950">{experiment.goal}</h3></div>
          {currentIteration && <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">Iteration {currentIteration.iterationNumber} · {experiment.clones.filter((entry) => entry.iterationId === currentIteration.id).length} clones · {tested}/{currentRequests.length} tested</span>}
        </div>
        {stableUrl ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">One permanent device URL</p>
            <p className="mt-2 break-all font-mono text-sm text-emerald-950">{stableUrl}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3"><button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white" onClick={() => void navigator.clipboard.writeText(stableUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1_500); })}>{copied ? "Copied" : "Copy URL"}</button><span className="text-xs text-emerald-800">Select a treatment below, then replay this same URL. No device reconfiguration or deploy is required.</span></div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-600">{experimentSetupMessage(experiment, draft.treatment?.shortLabel)}</p>
            {setupCanResume && <button className="mt-3 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40" disabled={continueSetup.isPending || !draft.treatment} onClick={() => continueSetup.mutate()}>{continueSetup.isPending ? "Planning and queueing…" : `Continue with CONTROL + ${draft.treatment?.shortLabel ?? "treatment"}`}</button>}
            {continueSetup.error && <p className="mt-3 text-xs text-rose-700">{continueSetup.error.message}</p>}
          </div>
        )}
      </div>

      <div className="grid gap-4 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {experiment.hypotheses.map((entry, index) => <div key={entry.id} className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4"><p className="text-xs font-semibold text-violet-700">H{index + 1} · {entry.status}</p><p className="mt-2 text-sm font-medium text-slate-900">{entry.statement}</p><p className="mt-2 text-xs leading-5 text-slate-600">{entry.rationale}</p></div>)}
        </div>
        {evaluationRunning && experiment.evaluationJob && <AgentEvaluationProgress job={experiment.evaluationJob} />}
        {allTested && experiment.status === "EVALUATING" && !evaluationRunning && <button className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>{evaluate.isPending ? "Queueing agent team…" : "Analyze results with agents"}</button>}
        {evaluate.error && <p className="text-xs text-rose-700">{evaluate.error.message}</p>}
        {latestEvaluation && <EvaluationCard experiment={experiment} onReanalyze={() => evaluate.mutate()} onRefresh={onRefresh} reanalyzing={evaluationRunning || evaluate.isPending} />}
        {previousIterations.length > 0 && <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"><summary className="cursor-pointer font-semibold text-slate-700">Previous iterations ({previousIterations.length})</summary><div className="mt-3 space-y-3">{previousIterations.map((iteration) => { const priorRequests = requests.filter((entry) => entry.iterationId === iteration.id); return <div className="rounded-xl border border-slate-200 bg-white p-3" key={iteration.id}><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Iteration {iteration.iterationNumber} · {iteration.status}</p><p className="mt-1 text-xs leading-5 text-slate-500">{iteration.rationale}</p><div className="mt-2 flex flex-wrap gap-2">{priorRequests.map((request) => <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[10px]" key={request.id}>{request.shortLabel}: {request.result?.outcome ?? request.status}</span>)}</div></div>; })}</div></details>}
        {latestEvaluation && cloneCards.length > 0 ? <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Observed test evidence · {tested}/{currentRequests.length} results</summary><div className="mt-4 grid gap-4">{cloneCards}</div></details> : cloneCards}
        {currentIteration && currentClones.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">The iteration is planned; clone jobs have not been created yet.</div>}
      </div>
    </article>
  );
}

function CloneBuildCard({ clone }: { clone: ExperimentDetail["clones"][number] }): JSX.Element {
  const failed = clone.state === "FAILED";
  return (
    <div className={`rounded-2xl border p-5 ${failed ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-mono text-sm font-bold text-sky-700">{clone.shortLabel}</p><p className="mt-1 text-xs text-slate-500">{clone.isControl ? "CONTROL" : "TREATMENT"}</p></div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${failed ? "border-rose-200 bg-rose-100 text-rose-800" : "border-amber-200 bg-amber-100 text-amber-800"}`}>{clone.state}</span>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">What changed</p>
      <p className="mt-1 text-sm leading-6 text-slate-700">{clone.executionPlan.whatChanged}</p>
      <p className="mt-3 text-xs leading-5 text-slate-500">{clone.executionPlan.expectedDiscriminatingSignal}</p>
      <p className="mt-4 text-xs text-slate-500">{failed ? (clone.errorMessage ?? "Clone creation or verification failed.") : cloneBuildMessage(clone.state)}</p>
    </div>
  );
}

function TestCard({ active, clone, experiment, request, onRefresh }: { active: boolean; clone: ExperimentDetail["clones"][number]; experiment: ExperimentDetail; request: ExperimentTestRequest; onRefresh(): Promise<void> }): JSX.Element {
  const [failureStage, setFailureStage] = useState<(typeof failureStages)[number][0]>("STARTUP");
  const [notes, setNotes] = useState("");
  const [showFailure, setShowFailure] = useState(false);
  const select = useMutation({ mutationFn: () => activateExperimentTest(request.id), onSuccess: onRefresh });
  const submit = useMutation({
    mutationFn: (outcome: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_TESTED") => submitExperimentTestResult(request.id, { outcome, ...(outcome === "FAIL" ? { failureStage } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), ...(experiment.targetEnvironmentId ? { testEnvironmentId: experiment.targetEnvironmentId } : {}) }),
    onSuccess: async () => { setShowFailure(false); await onRefresh(); },
  });
  const hypothesisText = request.hypothesisIds.map((id) => experiment.hypotheses.find((entry) => entry.id === id)?.statement).filter(Boolean).join(" · ");
  return (
    <div className={`rounded-2xl border p-5 ${active ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-sm font-bold text-sky-700">{request.shortLabel}</p><p className="mt-1 text-xs text-slate-500">{clone.isControl ? "CONTROL" : "TREATMENT"} · {clone.state}</p></div>{active && <span className="rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">Selected now</span>}</div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">What changed</p><p className="mt-1 text-sm leading-6 text-slate-700">{clone.executionPlan.whatChanged}</p>
      {hypothesisText && <><p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Hypothesis tested</p><p className="mt-1 text-sm text-slate-600">{hypothesisText}</p></>}
      <p className="mt-3 text-xs leading-5 text-slate-500">{clone.executionPlan.expectedDiscriminatingSignal}</p>
      {request.result ? <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">Reported: <strong className="text-slate-950">{request.result.outcome}</strong>{request.result.failureStage ? ` · ${request.result.failureStage}` : ""}</div> : (
        <>
          <button className="mt-4 w-full rounded-xl border border-sky-300 bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 disabled:opacity-40" disabled={select.isPending || clone.state !== "READY"} onClick={() => select.mutate()}>{active ? "Selected — replay the permanent URL" : "Select this treatment"}</button>
          <textarea className="mt-3 min-h-16 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400" placeholder="Optional observation notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ResultButton disabled={!active || submit.isPending} label="Works" onClick={() => submit.mutate("PASS")} />
            <ResultButton disabled={!active || submit.isPending} label="Fails" onClick={() => setShowFailure(true)} tone="fail" />
            <ResultButton disabled={!active || submit.isPending} label="Inconclusive" onClick={() => submit.mutate("INCONCLUSIVE")} />
            <ResultButton disabled={!active || submit.isPending} label="Unable to test" onClick={() => submit.mutate("NOT_TESTED")} />
          </div>
          {!active && <p className="mt-2 text-xs text-slate-500">Select this treatment before recording an observation.</p>}
          {showFailure && active && <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3"><select className="min-w-40 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" value={failureStage} onChange={(event) => setFailureStage(event.target.value as typeof failureStage)}>{failureStages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white" disabled={submit.isPending} onClick={() => submit.mutate("FAIL")}>Save failure</button></div>}
        </>
      )}
      <details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer">Advanced provenance</summary><div className="mt-2 space-y-1 break-all font-mono"><p>CloneSpec hash: {clone.specHash}</p><p>Plan: {clone.executionPlan.version} · processes: {clone.executionPlan.processes.length}</p><p>Verification: {clone.verification?.status ?? "pending"}</p>{clone.verification?.errors.map((entry) => <p className="text-rose-700" key={entry}>{entry}</p>)}<pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-[10px] leading-5 text-slate-500">{JSON.stringify(clone.provenance, null, 2)}</pre></div></details>
    </div>
  );
}

function AgentEvaluationProgress({ job }: { job: NonNullable<ExperimentDetail["evaluationJob"]> }): JSX.Element {
  return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-700">Agent evaluation · {job.status}</p><p className="mt-2 text-sm font-semibold text-slate-900">Evidence Auditor → Causal Analyst → Lead Experiment Investigator</p></div><span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs text-violet-700">Attempt {Math.max(job.attempts, 1)}/{job.maxAttempts}</span></div>
    <p className="mt-3 text-sm leading-6 text-slate-600">The worker is checking the observed comparison, testing causal scope, and preparing a bounded synthesis. This status comes from the persisted evaluation job.</p>
  </div>;
}

function EvaluationCard({ experiment, onReanalyze, onRefresh, reanalyzing }: { experiment: ExperimentDetail; onReanalyze(): void; onRefresh(): Promise<void>; reanalyzing: boolean }): JSX.Element {
  const evaluation = last(experiment.evaluations)!;
  const analysis = evaluation.analysis;
  const control = experiment.clones.find((entry) => entry.isControl);
  const representationIds = control?.executionPlan.selection.videoRepresentationIds ?? [];
  const [representationId, setRepresentationId] = useState(last(representationIds) ?? "");
  const remaining = evaluation.proposedNextExperimentPlan?.remainingHypothesisIds[0] ?? experiment.hypotheses[0]?.id;
  const followup = useMutation({
    mutationFn: async () => {
      if (!remaining || !representationId) throw new Error("No remaining hypothesis or representation is available.");
      const preview = await previewCloneRecipe({ recipe: "force_representation", investigationId: experiment.investigationId, shortLabel: `REP-${experiment.iterations.length + 1}`, hypothesisIds: [remaining], representationId });
      const iteration = await createExperimentIteration(experiment.id, "Focused follow-up generated from the remaining structured evidence.", [preview.spec]);
      await queueExperimentClones(experiment.id, iteration.id);
    },
    onSuccess: onRefresh,
  });
  if (!analysis) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-800">Legacy rule-only evaluation</p><p className="mt-2 text-sm leading-6 text-slate-700">{evaluation.summary}</p><p className="mt-3 text-sm leading-6 text-amber-900">This conclusion was produced before the post-experiment agent team existed. It may overstate the causal hypothesis.</p><button className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40" disabled={reanalyzing} onClick={onReanalyze}>{reanalyzing ? "Agent team queued…" : "Reanalyze with agents"}</button></div>;
  const outcomeLabel = analysis.outcome === "DISCRIMINATING_EFFECT" ? "Treatment effect observed" : analysis.outcome === "NO_DISCRIMINATING_EFFECT" ? "No treatment effect" : "Inconclusive";
  return <article className="overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-sm">
    <header className="border-b border-violet-100 bg-violet-50/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">{outcomeLabel}</span><span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">{evaluation.confidence} confidence</span><span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{analysis.source === "AI_ASSISTED" ? "Agent synthesis" : "Deterministic fallback"}</span></div>
      <h4 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">{analysis.title}</h4>
      <p className="mt-2 text-sm leading-6 text-slate-600">{analysis.confidenceRationale}</p>
    </header>
    <div className="grid gap-5 p-5 sm:p-6">
      <AnalysisSection label="What was observed" tone="sky"><p>{analysis.observation}</p></AnalysisSection>
      <AnalysisSection label="What this supports" tone="emerald"><p className="font-medium text-slate-900">{analysis.supportedClaim}</p><p className="mt-2">{analysis.interpretation}</p></AnalysisSection>
      <div className="grid gap-4 lg:grid-cols-2">
        <AnalysisList label="What this does not establish" values={analysis.notEstablished} tone="amber" />
        <AnalysisList label="Plausible alternative explanations" values={analysis.alternativeExplanations} tone="slate" />
      </div>
      <AnalysisList label="Evidence limitations" values={analysis.limitations} tone="slate" />
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">Next discriminating test</p><h5 className="mt-2 text-base font-semibold text-slate-950">{analysis.nextTest.title}</h5><p className="mt-2 text-sm leading-6 text-slate-700">{analysis.nextTest.rationale}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-violet-100 bg-white p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Change</p><p className="mt-1 text-xs leading-5 text-slate-700">{analysis.nextTest.change}</p></div><div className="rounded-xl border border-violet-100 bg-white p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Expected signal</p><p className="mt-1 text-xs leading-5 text-slate-700">{analysis.nextTest.expectedSignal}</p></div></div>
        {experiment.status === "FOLLOWUP_REQUIRED" && evaluation.proposedNextExperimentPlan && <div className="mt-4 border-t border-violet-200 pt-4"><div className="flex flex-wrap gap-2"><select className="min-w-48 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" value={representationId} onChange={(event) => setRepresentationId(event.target.value)}>{representationIds.map((id) => <option key={id} value={id}>Expose {id}</option>)}</select><button className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={!representationId || followup.isPending} onClick={() => followup.mutate()}>{followup.isPending ? "Creating…" : "Build focused follow-up"}</button></div>{followup.error && <p className="mt-2 text-xs text-rose-700">{followup.error.message}</p>}</div>}
      </div>
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Agent team</p><div className="mt-3 grid gap-3 md:grid-cols-3">{analysis.agents.map((agent) => <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={agent.id}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{agent.label}</p><span className={`text-[9px] font-bold uppercase tracking-wider ${agent.state === "COMPLETED" ? "text-emerald-700" : "text-amber-700"}`}>{agent.state}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{agent.summary ?? agent.limitation ?? "No structured output."}</p></div>)}</div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">Hypothesis status is bounded by the treatment actually applied.</p><button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40" disabled={reanalyzing} onClick={onReanalyze}>{reanalyzing ? "Reanalysis queued…" : "Run agent team again"}</button></div>
    </div>
  </article>;
}

function AnalysisSection({ label, tone, children }: { label: string; tone: "sky" | "emerald"; children: ReactNode }): JSX.Element {
  const styles = tone === "sky" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return <div className={`rounded-2xl border p-4 ${styles}`}><p className="text-xs font-semibold uppercase tracking-[0.14em]">{label}</p><div className="mt-2 text-sm leading-6 text-slate-700">{children}</div></div>;
}

function AnalysisList({ label, values, tone }: { label: string; values: string[]; tone: "amber" | "slate" }): JSX.Element {
  const styles = tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50";
  return <div className={`rounded-2xl border p-4 ${styles}`}><p className={`text-xs font-semibold uppercase tracking-[0.14em] ${tone === "amber" ? "text-amber-800" : "text-slate-600"}`}>{label}</p>{values.length > 0 ? <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">{values.map((value) => <li className="flex gap-2" key={value}><span aria-hidden="true">•</span><span>{value}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">None recorded.</p>}</div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }): JSX.Element { return <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}<input className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm normal-case tracking-normal text-slate-800 outline-none focus:border-violet-400" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function ResultButton({ label, disabled, onClick, tone = "normal" }: { label: string; disabled: boolean; onClick(): void; tone?: "normal" | "fail" }): JSX.Element { return <button className={`rounded-lg border bg-white px-2 py-2 text-xs font-semibold disabled:opacity-30 ${tone === "fail" ? "border-rose-200 text-rose-700" : "border-slate-200 text-slate-700"}`} disabled={disabled} onClick={onClick}>{label}</button>; }
function last<T>(values: readonly T[]): T | undefined { return values[values.length - 1]; }
function experimentSetupMessage(experiment: ExperimentDetail, treatmentLabel?: string): string {
  const comparison = `CONTROL and ${treatmentLabel ?? "the diagnosis-specific treatment"}`;
  if (experiment.status === "DRAFT") return `The experiment exists, but its first clone plan was not saved. Continue setup to create ${comparison}.`;
  if (experiment.status === "PLANNED") return "The clone plan is saved but has not been queued. Continue setup without creating another experiment.";
  if (experiment.status === "BUILDING_CLONES") return `${comparison} are queued, building, or being deterministically verified. The permanent URL appears after a valid treatment is ready.`;
  if (experiment.status === "FAILED") return "Clone creation or verification failed. Review the clone errors below; no playable treatment is being advertised.";
  return "No verified treatment URL is available for the current experiment state.";
}
function cloneBuildMessage(state: ExperimentDetail["clones"][number]["state"]): string {
  if (state === "QUEUED") return "Waiting for the media worker.";
  if (state === "BUILDING") return "Recording the bounded source snapshot through the clone path.";
  if (state === "VERIFYING") return "Running deterministic verification before exposing this treatment.";
  if (state === "READY") return "Verified; preparing the device test request.";
  return "Clone creation or verification failed.";
}

type ValidationDraft = {
  goal: string;
  hypothesis: string;
  rationale: string;
  sourceConclusion: string;
  proofBoundary: string;
  source: "agent" | "diagnosis-fallback";
  treatment?: {
    recipe: "single_video_representation" | "representation_subset" | "single_audio";
    shortLabel: string;
    representationIds: string[];
  };
};

function validationDraft(report: InvestigationReport): ValidationDraft {
  const content = report.content.placeholder ? undefined : report.content;
  const ai = content?.ai?.available ? content.ai : undefined;
  const sourceConclusion = ai?.likelyCause ?? ai?.summary ?? content?.summary ?? "The current report does not identify a single likely cause.";
  if (ai?.validationPlan) return { ...ai.validationPlan, sourceConclusion, source: "agent" };
  const fallback = diagnosisSpecificFallback(report, sourceConclusion);
  return {
    ...fallback,
    rationale: `${fallback.rationale} Final report: ${sourceConclusion}`,
    sourceConclusion,
    source: "diagnosis-fallback",
  };
}

function diagnosisSpecificFallback(report: InvestigationReport, sourceConclusion: string): Omit<ValidationDraft, "sourceConclusion" | "source"> {
  const content = report.content.placeholder ? undefined : report.content;
  const evidence = content?.evidence;
  const representations = evidence && "abr" in evidence ? evidence.abr?.ladder.representations ?? [] : [];
  const lower = sourceConclusion.toLocaleLowerCase();
  const aac = representations.filter((entry) => /(?:mp4a|aac)/i.test(entry.codecs ?? "")).map((entry) => entry.id);
  if (/(?:e-?ac-?3|ec-3|aac|audio|áudio)/i.test(lower) && aac.length > 0 && aac.length < representations.length) {
    return {
      goal: "Determine whether removing the E-AC-3 representation group changes the reported playback outcome",
      hypothesis: "If reconfiguration between AAC and E-AC-3 groups contributes to the reported freeze, an AAC-only ladder will reduce or eliminate the failure compared with the full-ladder CONTROL on the same device.",
      rationale: "The treatment keeps the AAC representation group and removes the cross-audio-family ABR path identified by the diagnosis.",
      proofBoundary: "CONTROL versus AAC-ONLY can show whether removing the E-AC-3 group changes the device outcome. It cannot by itself prove a decoder failure or identify the exact switch without device telemetry.",
      treatment: { recipe: "representation_subset", shortLabel: "AAC-ONLY", representationIds: aac },
    };
  }
  const mentionedVariant = /variant\s*[-#]?\s*(\d+)/i.exec(sourceConclusion)?.[1];
  const representationId = mentionedVariant ? `variant-${mentionedVariant}` : undefined;
  if (representationId && representations.some((entry) => entry.id === representationId)) {
    return {
      goal: `Determine whether the issue follows ${representationId}`,
      hypothesis: `If ${representationId} contains the diagnosed representation-specific issue, forcing it will reproduce the failure more consistently than the full-ladder CONTROL.`,
      rationale: `The treatment isolates ${representationId}, the representation named by the diagnosis.`,
      proofBoundary: `CONTROL versus ${representationId} can associate the outcome with that representation. It cannot prove the internal player mechanism without attributed telemetry.`,
      treatment: { recipe: "single_video_representation", shortLabel: `REP-${mentionedVariant}`, representationIds: [representationId] },
    };
  }
  const lowest = [...representations].filter((entry) => entry.bandwidth !== undefined).sort((left, right) => left.bandwidth! - right.bandwidth!)[0];
  if (lowest && /(?:lat[eê]ncia|throughput|delivery|bitrate|buffer|rede|network)/i.test(lower)) {
    return {
      goal: "Determine whether reducing media demand changes the reported playback outcome",
      hypothesis: "If delivery pressure contributes to the reported buffering, forcing the lowest representation will reduce or eliminate the failure compared with the full-ladder CONTROL on the same device.",
      rationale: "The treatment reduces media demand while preserving the clone and playback path.",
      proofBoundary: "CONTROL versus LOW-BR can show whether representation demand changes the device outcome. It does not emulate origin latency or prove buffer behavior without telemetry.",
      treatment: { recipe: "single_video_representation", shortLabel: "LOW-BR", representationIds: [lowest.id] },
    };
  }
  return {
    goal: "Design a controlled validation for the reported diagnosis",
    hypothesis: sourceConclusion,
    rationale: "The current report has no clone transformation that safely discriminates this diagnosis.",
    proofBoundary: "No supported automatic treatment currently isolates this diagnosis. Run the agent analysis again or add the required clone capability before testing.",
  };
}

function treatmentPreviewInput(draft: ValidationDraft, investigationId: string, hypothesisId: string): Parameters<typeof previewCloneRecipe>[0] {
  if (!draft.treatment) throw new Error("No supported treatment is available.");
  const common = { recipe: draft.treatment.recipe, investigationId, shortLabel: draft.treatment.shortLabel, hypothesisIds: [hypothesisId] };
  if (draft.treatment.recipe === "representation_subset") return { ...common, recipe: "representation_subset", representationIds: draft.treatment.representationIds };
  if (draft.treatment.recipe === "single_video_representation") return { ...common, recipe: "single_video_representation", representationId: draft.treatment.representationIds[0] };
  return { ...common, recipe: "single_audio" };
}
