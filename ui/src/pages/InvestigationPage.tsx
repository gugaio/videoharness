import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getInvestigation,
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
    refetchInterval: 5_000,
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
    <main className="min-h-screen bg-harness-bg text-harness-text">
      <div className="mx-auto w-full max-w-4xl px-5 pb-20 pt-6 sm:px-8">
        <header className="flex items-center justify-between">
          <Link className="flex items-center gap-3 text-sm font-semibold" to="/">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.06] font-mono text-xs">VHS</span>
            <span className="hidden sm:inline">Video Harness Space</span>
          </Link>
          <span className="flex items-center gap-2 text-xs text-harness-muted">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-harness-success" : "bg-amber-300"}`} />
            {connected ? "Live" : "Reconnecting"}
          </span>
        </header>

        {investigation.isLoading && <p className="mt-24 text-center text-harness-muted">Opening investigation…</p>}
        {investigation.error && (
          <div className="mt-20 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-6 text-rose-200">
            {investigation.error.message}
          </div>
        )}

        {investigation.data && (
          <>
            <section className="mt-14 rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-panel sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-xs capitalize text-blue-200">
                  {investigation.data.state}
                </span>
                <span className="font-mono text-xs text-white/30">{investigation.data.id}</span>
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Investigation in progress</h1>
              <p className="mt-3 break-all font-mono text-sm text-harness-muted">{investigation.data.sourceUrl}</p>
              {investigation.data.problemDescription && (
                <div className="mt-6 border-l border-white/20 pl-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/35">Problem reported</p>
                  <p className="mt-2 leading-7 text-white/85">{investigation.data.problemDescription}</p>
                </div>
              )}
            </section>

            <section className="mt-10">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/35">Investigation timeline</p>
                  <h2 className="mt-2 text-xl font-medium">What the team has observed</h2>
                </div>
                <span className="text-xs text-harness-muted">{events.length} event{events.length === 1 ? "" : "s"}</span>
              </div>

              <div className="relative mt-7 space-y-4 before:absolute before:bottom-5 before:left-[19px] before:top-5 before:w-px before:bg-white/10">
                {events.map((event) => <TimelineEvent event={event} key={event.id} />)}
                {events.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-harness-muted">
                    Restoring persisted investigation events…
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function TimelineEvent({ event }: { event: InvestigationEvent }): JSX.Element {
  return (
    <article className="relative pl-14">
      <span className="absolute left-1 top-3 grid h-8 w-8 place-items-center rounded-full border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">✓</span>
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-white/40">{event.actor}</span>
          <time className="text-xs text-white/30">{new Date(event.createdAt).toLocaleTimeString()}</time>
        </div>
        <p className="mt-2 text-sm leading-6 text-white/85">{event.message}</p>
      </div>
    </article>
  );
}
