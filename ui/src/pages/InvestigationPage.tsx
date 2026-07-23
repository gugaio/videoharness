import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CaseHero } from "../components/CaseHero";
import { InvestigationFeed } from "../components/InvestigationFeed";
import { InvestigationReportView } from "../components/InvestigationReport";
import {
  getInvestigation,
  getInvestigationReport,
  InvestigationEventSchema,
  type InvestigationEvent,
} from "../lib/api";

export function InvestigationPage(): JSX.Element {
  const { investigationId = "" } = useParams();
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const investigation = useQuery({
    queryKey: ["investigation", investigationId],
    queryFn: () => getInvestigation(investigationId),
    enabled: Boolean(investigationId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "completed" || state === "failed" ? false : 2_000;
    },
  });
  const report = useQuery({
    queryKey: ["investigation-report", investigationId],
    queryFn: () => getInvestigationReport(investigationId),
    enabled: investigation.data?.state === "completed",
  });

  useEffect(() => {
    if (!investigationId) return;
    const source = new EventSource(`/v1/investigations/${encodeURIComponent(investigationId)}/events`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("investigation.event", (rawEvent) => {
      try {
        const parsed = InvestigationEventSchema.safeParse(JSON.parse((rawEvent as MessageEvent<string>).data));
        if (!parsed.success) return;
        setEvents((current) => {
          if (current.some((event) => event.id === parsed.data.id)) return current;
          return [...current, parsed.data].sort((left, right) => Number(left.id) - Number(right.id));
        });
      } catch {
        // Ignore malformed transport events; persisted events remain available on reconnect.
      }
    });
    return () => source.close();
  }, [investigationId]);

  return (
    <main className="relative min-h-screen bg-harness-bg text-harness-text">
      <AuroraBackdrop />
      <div className="relative mx-auto w-full max-w-3xl px-5 pb-24 pt-6 sm:px-8">
        <header className="flex items-center justify-between">
          <Link className="group flex items-center gap-3 text-sm font-semibold" to="/">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sky-400/80 via-violet-500/80 to-fuchsia-500/80 font-mono text-[11px] font-bold text-white shadow-lg shadow-violet-500/20 transition group-hover:brightness-110">
              V
            </span>
            <span className="hidden text-white/85 sm:inline">Video Harness Space</span>
          </Link>
          <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400 animate-pulse-dot" : "bg-amber-300"
              }`}
            />
            {connected ? "Live" : "Reconnecting"}
          </span>
        </header>

        {investigation.isLoading && (
          <p className="mt-24 text-center text-sm text-harness-muted">Opening investigation…</p>
        )}
        {investigation.error && (
          <div className="mt-20 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-6 text-sm text-rose-200">
            {investigation.error.message}
          </div>
        )}

        {investigation.data && (
          <div className="mt-8">
            <CaseHero investigation={investigation.data} />
            <InvestigationFeed
              connected={connected}
              events={events}
              state={investigation.data.state}
            />
            {report.data && <InvestigationReportView report={report.data} />}
          </div>
        )}
      </div>
    </main>
  );
}

function AuroraBackdrop(): JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 animate-aurora-drift rounded-full bg-gradient-to-r from-sky-500/[0.07] via-violet-500/[0.08] to-fuchsia-500/[0.06] blur-3xl" />
      <div className="absolute right-[-180px] top-1/3 h-[380px] w-[380px] animate-aurora-drift rounded-full bg-violet-500/[0.05] blur-3xl [animation-delay:-8s]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}
