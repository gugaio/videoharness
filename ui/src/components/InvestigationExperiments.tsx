import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
} from "../lib/api";

const failureStages = [
  ["LOAD_MANIFEST", "Manifest load"], ["STARTUP", "Startup"], ["VIDEO_DECODE", "Video"], ["AUDIO_DECODE", "Audio"],
  ["DRM", "DRM"], ["STALL", "Stall"], ["ABR_SWITCH", "ABR switch"], ["SEEK", "Seek"], ["AV_SYNC", "A/V sync"],
  ["SUBTITLES", "Subtitles"], ["UNKNOWN", "Other"],
] as const;

export function InvestigationExperiments({ investigationId }: { investigationId: string }): JSX.Element {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [goal, setGoal] = useState("Identify the smallest controlled change that restores playback");
  const [hypothesis, setHypothesis] = useState("One representation in the source ladder is incompatible with the target device");
  const [rationale, setRationale] = useState("The deterministic investigation cannot prove device decode/render behavior without a controlled replay.");
  const [environmentId, setEnvironmentId] = useState("");
  const [environmentName, setEnvironmentName] = useState("");
  const [environmentPlatform, setEnvironmentPlatform] = useState("");
  const [message, setMessage] = useState<string>();

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
      const control = await previewCloneRecipe({ recipe: "control", investigationId, shortLabel: "CONTROL", hypothesisIds: [] });
      const experiment = await createExperiment(investigationId, { goal, hypothesis, rationale, ...(environmentId ? { targetEnvironmentId: environmentId } : {}) });
      setSelectedId(experiment.id);
      const hypothesisId = experiment.hypotheses[0]!.id;
      const treatment = await previewCloneRecipe({ recipe: "single_video_representation", investigationId, shortLabel: "LOW-BR", hypothesisIds: [hypothesisId] });
      const iteration = await createExperimentIteration(experiment.id, "First small discriminating set: control plus one representation-selection treatment.", [control.spec, treatment.spec]);
      await queueExperimentClones(experiment.id, iteration.id);
      return experiment.id;
    },
    onSuccess: async (id) => { setSelectedId(id); setMessage("Experiment created. The worker is building and verifying CONTROL and LOW-BR."); await refresh(id); },
    onError: async (error) => { setMessage(error instanceof Error ? error.message : "Could not create the experiment."); await refresh(); },
  });
  const saveEnvironment = useMutation({
    mutationFn: () => createTestEnvironment({ name: environmentName, ...(environmentPlatform ? { platform: environmentPlatform } : {}) }),
    onSuccess: async (environment) => { setEnvironmentId(environment.id); setEnvironmentName(""); setEnvironmentPlatform(""); await client.invalidateQueries({ queryKey: ["test-environments"] }); },
  });

  return (
    <section className="mt-10 border-t border-white/[0.08] pt-10" aria-labelledby="experiments-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/65">Closed-loop lab</p>
          <h2 className="mt-2 text-2xl font-semibold text-white" id="experiments-title">Experiments</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Build a small controlled set, select one treatment, replay the same URL on the device, and record only what was actually observed.</p>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Diagnostic goal" value={goal} onChange={setGoal} />
          <Field label="Hypothesis" value={hypothesis} onChange={setHypothesis} />
          <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Rationale
            <textarea className="mt-2 min-h-20 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300/40" value={rationale} onChange={(event) => setRationale(event.target.value)} />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Target environment
            <select className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-white" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="">Not specified</option>
              {environments.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.platform ? ` · ${entry.platform}` : ""}</option>)}
            </select>
          </label>
          <button className="self-end rounded-xl bg-sky-300 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-40" disabled={createFlow.isPending || goal.trim().length < 3 || hypothesis.trim().length < 3} onClick={() => createFlow.mutate()}>
            {createFlow.isPending ? "Planning…" : "Create control + treatment"}
          </button>
        </div>
        <details className="mt-4 border-t border-white/[0.06] pt-4 text-sm text-white/55">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Save a device environment</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white" placeholder="Living room TV" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} />
            <input className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white" placeholder="Tizen 7 / webOS / Android TV" value={environmentPlatform} onChange={(event) => setEnvironmentPlatform(event.target.value)} />
            <button className="rounded-xl border border-white/10 px-4 py-2 text-white/75 disabled:opacity-40" disabled={!environmentName.trim() || saveEnvironment.isPending} onClick={() => saveEnvironment.mutate()}>Save</button>
          </div>
        </details>
        {message && <p className="mt-4 rounded-xl bg-sky-300/[0.06] px-3 py-2 text-sm text-sky-100/75">{message}</p>}
      </div>

      {summaries.data && summaries.data.length > 0 && (
        <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
          {summaries.data.map((entry) => <button key={entry.id} className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${selectedId === entry.id ? "border-sky-300/40 bg-sky-300/10 text-sky-100" : "border-white/10 text-white/55"}`} onClick={() => setSelectedId(entry.id)}>{entry.goal.slice(0, 42)} · {entry.status}</button>)}
        </div>
      )}
      {detail.data && <ExperimentPanel experiment={detail.data} onRefresh={() => refresh(detail.data.id)} />}
    </section>
  );
}

function ExperimentPanel({ experiment, onRefresh }: { experiment: ExperimentDetail; onRefresh(): Promise<void> }): JSX.Element {
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
      const [control, treatment] = await Promise.all([
        previewCloneRecipe({ recipe: "control", investigationId: experiment.investigationId, shortLabel: "CONTROL", hypothesisIds: [] }),
        previewCloneRecipe({ recipe: "single_video_representation", investigationId: experiment.investigationId, shortLabel: "LOW-BR", hypothesisIds: [hypothesisId] }),
      ]);
      const iteration = await createExperimentIteration(experiment.id, "First small discriminating set: control plus one representation-selection treatment.", [control.spec, treatment.spec]);
      await queueExperimentClones(experiment.id, iteration.id);
    },
    onSuccess: onRefresh,
  });
  const allTested = currentRequests.length > 0 && tested === currentRequests.length;
  const setupCanResume = experiment.status === "DRAFT" || (experiment.status === "PLANNED" && Boolean(currentIteration));

  return (
    <article className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0d111b]/90">
      <div className="border-b border-white/[0.07] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-200/60">{experiment.status}</p><h3 className="mt-2 text-xl font-semibold text-white">{experiment.goal}</h3></div>
          {currentIteration && <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55">Iteration {currentIteration.iterationNumber} · {experiment.clones.filter((entry) => entry.iterationId === currentIteration.id).length} clones · {tested}/{currentRequests.length} tested</span>}
        </div>
        {stableUrl ? (
          <div className="mt-5 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-200/65">One permanent device URL</p>
            <p className="mt-2 break-all font-mono text-sm text-emerald-50">{stableUrl}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3"><button className="rounded-lg bg-emerald-200 px-3 py-2 text-xs font-bold text-emerald-950" onClick={() => void navigator.clipboard.writeText(stableUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1_500); })}>{copied ? "Copied" : "Copy URL"}</button><span className="text-xs text-white/45">Select a treatment below, then replay this same URL. No device reconfiguration or deploy is required.</span></div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="text-sm text-white/55">{experimentSetupMessage(experiment)}</p>
            {setupCanResume && <button className="mt-3 rounded-xl bg-sky-300 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-40" disabled={continueSetup.isPending} onClick={() => continueSetup.mutate()}>{continueSetup.isPending ? "Planning and queueing…" : "Continue with CONTROL + LOW-BR"}</button>}
            {continueSetup.error && <p className="mt-3 text-xs text-rose-200">{continueSetup.error.message}</p>}
          </div>
        )}
      </div>

      <div className="grid gap-4 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {experiment.hypotheses.map((entry, index) => <div key={entry.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs font-semibold text-violet-200/70">H{index + 1} · {entry.status}</p><p className="mt-2 text-sm font-medium text-white/85">{entry.statement}</p><p className="mt-2 text-xs leading-5 text-white/45">{entry.rationale}</p></div>)}
        </div>
        {previousIterations.length > 0 && <details className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-white/55"><summary className="cursor-pointer font-semibold text-white/65">Previous iterations ({previousIterations.length})</summary><div className="mt-3 space-y-3">{previousIterations.map((iteration) => { const priorRequests = requests.filter((entry) => entry.iterationId === iteration.id); return <div className="rounded-xl border border-white/[0.06] p-3" key={iteration.id}><p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Iteration {iteration.iterationNumber} · {iteration.status}</p><p className="mt-1 text-xs leading-5 text-white/40">{iteration.rationale}</p><div className="mt-2 flex flex-wrap gap-2">{priorRequests.map((request) => <span className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[10px]" key={request.id}>{request.shortLabel}: {request.result?.outcome ?? request.status}</span>)}</div></div>; })}</div></details>}
        {currentClones.map((clone) => {
          const request = currentRequests.find((entry) => entry.cloneId === clone.id);
          return request
            ? <TestCard key={clone.id} active={experiment.activeTestRequestId === request.id} clone={clone} experiment={experiment} request={request} onRefresh={onRefresh} />
            : <CloneBuildCard key={clone.id} clone={clone} />;
        })}
        {currentIteration && currentClones.length === 0 && <div className="rounded-2xl border border-white/[0.07] p-5 text-sm text-white/50">The iteration is planned; clone jobs have not been created yet.</div>}
        {allTested && !["CONCLUDED", "FOLLOWUP_REQUIRED"].includes(experiment.status) && <button className="rounded-xl bg-violet-300 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>{evaluate.isPending ? "Evaluating evidence…" : "Evaluate completed results"}</button>}
        {latestEvaluation && <EvaluationCard experiment={experiment} onRefresh={onRefresh} />}
      </div>
    </article>
  );
}

function CloneBuildCard({ clone }: { clone: ExperimentDetail["clones"][number] }): JSX.Element {
  const failed = clone.state === "FAILED";
  return (
    <div className={`rounded-2xl border p-5 ${failed ? "border-rose-300/20 bg-rose-300/[0.04]" : "border-white/[0.08] bg-white/[0.02]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-mono text-sm font-bold text-sky-100">{clone.shortLabel}</p><p className="mt-1 text-xs text-white/40">{clone.isControl ? "CONTROL" : "TREATMENT"}</p></div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${failed ? "border-rose-300/20 text-rose-100" : "border-amber-300/20 text-amber-100"}`}>{clone.state}</span>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/35">What changed</p>
      <p className="mt-1 text-sm leading-6 text-white/75">{clone.executionPlan.whatChanged}</p>
      <p className="mt-3 text-xs leading-5 text-white/40">{clone.executionPlan.expectedDiscriminatingSignal}</p>
      <p className="mt-4 text-xs text-white/40">{failed ? (clone.errorMessage ?? "Clone creation or verification failed.") : cloneBuildMessage(clone.state)}</p>
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
    <div className={`rounded-2xl border p-5 ${active ? "border-sky-300/35 bg-sky-300/[0.055]" : "border-white/[0.08] bg-white/[0.02]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-sm font-bold text-sky-100">{request.shortLabel}</p><p className="mt-1 text-xs text-white/40">{clone.isControl ? "CONTROL" : "TREATMENT"} · {clone.state}</p></div>{active && <span className="rounded-full bg-sky-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-950">Selected now</span>}</div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/35">What changed</p><p className="mt-1 text-sm leading-6 text-white/75">{clone.executionPlan.whatChanged}</p>
      {hypothesisText && <><p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/35">Hypothesis tested</p><p className="mt-1 text-sm text-white/60">{hypothesisText}</p></>}
      <p className="mt-3 text-xs leading-5 text-white/40">{clone.executionPlan.expectedDiscriminatingSignal}</p>
      {request.result ? <div className="mt-4 rounded-xl bg-white/[0.05] px-3 py-2 text-sm text-white/70">Reported: <strong className="text-white">{request.result.outcome}</strong>{request.result.failureStage ? ` · ${request.result.failureStage}` : ""}</div> : (
        <>
          <button className="mt-4 w-full rounded-xl border border-sky-300/25 bg-sky-300/10 px-4 py-2.5 text-sm font-semibold text-sky-100 disabled:opacity-40" disabled={select.isPending || clone.state !== "READY"} onClick={() => select.mutate()}>{active ? "Selected — replay the permanent URL" : "Select this treatment"}</button>
          <textarea className="mt-3 min-h-16 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" placeholder="Optional observation notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ResultButton disabled={!active || submit.isPending} label="Works" onClick={() => submit.mutate("PASS")} />
            <ResultButton disabled={!active || submit.isPending} label="Fails" onClick={() => setShowFailure(true)} tone="fail" />
            <ResultButton disabled={!active || submit.isPending} label="Inconclusive" onClick={() => submit.mutate("INCONCLUSIVE")} />
            <ResultButton disabled={!active || submit.isPending} label="Unable to test" onClick={() => submit.mutate("NOT_TESTED")} />
          </div>
          {!active && <p className="mt-2 text-xs text-white/35">Select this treatment before recording an observation.</p>}
          {showFailure && active && <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.04] p-3"><select className="min-w-40 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" value={failureStage} onChange={(event) => setFailureStage(event.target.value as typeof failureStage)}>{failureStages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="rounded-lg bg-rose-200 px-4 py-2 text-sm font-bold text-rose-950" disabled={submit.isPending} onClick={() => submit.mutate("FAIL")}>Save failure</button></div>}
        </>
      )}
      <details className="mt-4 text-xs text-white/40"><summary className="cursor-pointer">Advanced provenance</summary><div className="mt-2 space-y-1 break-all font-mono"><p>CloneSpec hash: {clone.specHash}</p><p>Plan: {clone.executionPlan.version} · processes: {clone.executionPlan.processes.length}</p><p>Verification: {clone.verification?.status ?? "pending"}</p>{clone.verification?.errors.map((entry) => <p className="text-rose-200/70" key={entry}>{entry}</p>)}<pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-3 text-[10px] leading-5 text-white/35">{JSON.stringify(clone.provenance, null, 2)}</pre></div></details>
    </div>
  );
}

function EvaluationCard({ experiment, onRefresh }: { experiment: ExperimentDetail; onRefresh(): Promise<void> }): JSX.Element {
  const evaluation = last(experiment.evaluations)!;
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
  return <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.045] p-5"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-200/65">Evaluation · {evaluation.status} · {evaluation.confidence}</p><p className="mt-2 text-sm leading-6 text-white/75">{evaluation.summary}</p>{experiment.status === "FOLLOWUP_REQUIRED" && evaluation.proposedNextExperimentPlan && <div className="mt-4 border-t border-white/[0.07] pt-4"><p className="text-sm text-white/60">{evaluation.proposedNextExperimentPlan.rationale}</p><div className="mt-3 flex flex-wrap gap-2"><select className="min-w-48 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" value={representationId} onChange={(event) => setRepresentationId(event.target.value)}>{representationIds.map((id) => <option key={id} value={id}>Expose {id}</option>)}</select><button className="rounded-xl bg-violet-200 px-4 py-2 text-sm font-bold text-violet-950 disabled:opacity-40" disabled={!representationId || followup.isPending} onClick={() => followup.mutate()}>{followup.isPending ? "Creating…" : "Create focused follow-up"}</button></div>{followup.error && <p className="mt-2 text-xs text-rose-200">{followup.error.message}</p>}</div>}</div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }): JSX.Element { return <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">{label}<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-sky-300/40" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function ResultButton({ label, disabled, onClick, tone = "normal" }: { label: string; disabled: boolean; onClick(): void; tone?: "normal" | "fail" }): JSX.Element { return <button className={`rounded-lg border px-2 py-2 text-xs font-semibold disabled:opacity-30 ${tone === "fail" ? "border-rose-300/20 text-rose-100" : "border-white/10 text-white/65"}`} disabled={disabled} onClick={onClick}>{label}</button>; }
function last<T>(values: readonly T[]): T | undefined { return values[values.length - 1]; }
function experimentSetupMessage(experiment: ExperimentDetail): string {
  if (experiment.status === "DRAFT") return "The experiment exists, but its first clone plan was not saved. Continue setup to create CONTROL and LOW-BR.";
  if (experiment.status === "PLANNED") return "The clone plan is saved but has not been queued. Continue setup without creating another experiment.";
  if (experiment.status === "BUILDING_CLONES") return "CONTROL and LOW-BR are queued, building, or being deterministically verified. The permanent URL appears after a valid treatment is ready.";
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
