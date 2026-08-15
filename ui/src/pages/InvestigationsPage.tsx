import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteInvestigation, getHealth, listInvestigations, type Investigation } from "../lib/api";

export function InvestigationsPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string>();
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 15_000 });
  const list = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
    refetchInterval: 4_000,
  });
  const remove = useMutation({
    mutationFn: deleteInvestigation,
    onSuccess: async () => {
      setConfirmingId(undefined);
      await queryClient.invalidateQueries({ queryKey: ["investigations"] });
    },
  });

  const investigations = list.data ?? [];

  return (
    <main className="relative min-h-screen overflow-hidden bg-harness-bg text-harness-text">
      <NetworkBackdrop />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-5 pb-10 pt-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <a className="group flex items-center gap-3 text-sm font-semibold tracking-tight" href="/">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sky-400/80 via-violet-500/80 to-fuchsia-500/80 font-mono text-[11px] font-bold text-white shadow-lg shadow-violet-500/20 transition group-hover:brightness-110">
              V
            </span>
            <span className="hidden text-white/90 sm:inline">Video Harness Space</span>
          </a>
          <div className="flex items-center gap-2 text-xs text-harness-muted">
            <span
              className={`h-2 w-2 rounded-full ${
                health.data?.ok ? "bg-harness-success shadow-[0_0_12px_rgba(67,209,139,0.7)]" : "bg-white/20"
              }`}
            />
            {health.data?.ok ? "Systems ready" : health.isError ? "API offline" : "Checking systems"}
          </div>
        </header>

        <section className="flex flex-1 flex-col py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-white/40">Investigate</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Investigations</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-harness-muted">
                Open a case to inspect the collected evidence, or delete it together with its files, recordings and lab workspace.
              </p>
            </div>
            <button
              className="h-11 rounded-xl bg-gradient-to-r from-sky-300 via-violet-300 to-fuchsia-300 px-5 text-sm font-semibold text-[#0a0c12] shadow-lg shadow-violet-500/20 transition hover:brightness-110"
              onClick={() => navigate("/")}
              type="button"
            >
              New investigation
            </button>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-white/15 bg-black/25 backdrop-blur-xl">
            {list.isLoading && investigations.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-white/40">Loading investigations…</p>
            ) : investigations.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-white/40">
                No investigations yet. Paste a stream URL on the home page to start one.
              </p>
            ) : (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.18em] text-white/35">
                    <th className="px-5 py-3 font-medium">Stream</th>
                    <th className="hidden px-5 py-3 font-medium md:table-cell">State</th>
                    <th className="hidden px-5 py-3 font-medium md:table-cell">Created</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {investigations.map((investigation) => (
                    <InvestigationRow
                      key={investigation.id}
                      investigation={investigation}
                      confirming={confirmingId === investigation.id}
                      deleting={remove.isPending && confirmingId === investigation.id}
                      onOpen={() => navigate(`/investigations/${encodeURIComponent(investigation.id)}`)}
                      onDelete={() => setConfirmingId(confirmingId === investigation.id ? undefined : investigation.id)}
                      onConfirmDelete={() => remove.mutate(investigation.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {remove.error && (
            <p className="mt-4 text-sm text-rose-300">{remove.error.message}</p>
          )}
        </section>
      </div>
    </main>
  );
}

function InvestigationRow(props: {
  investigation: Investigation;
  confirming: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
}): JSX.Element {
  const { investigation } = props;
  const stateLabel = stateLabelFor(investigation.state);
  return (
    <tr className="border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.03]">
      <td className="px-5 py-4">
        <button className="block max-w-full text-left" onClick={props.onOpen} type="button">
          <span className="block truncate font-mono text-xs text-white/80">{truncateUrl(investigation.sourceUrl)}</span>
          {investigation.problemDescription && (
            <span className="mt-1 block max-w-xl truncate text-xs text-white/35">{investigation.problemDescription}</span>
          )}
        </button>
      </td>
      <td className="hidden px-5 py-4 md:table-cell">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${stateTone[investigation.state] ?? "bg-white/[0.06] text-white/50"}`}>
          {stateLabel}
        </span>
      </td>
      <td className="hidden px-5 py-4 text-xs text-white/45 md:table-cell">
        {formatDate(investigation.createdAt)}
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center justify-end gap-2">
          <button
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-sky-200/40 hover:text-white"
            onClick={props.onOpen}
            type="button"
          >
            Open
          </button>
          {props.confirming ? (
            <button
              className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.deleting}
              onClick={props.onConfirmDelete}
              type="button"
            >
              {props.deleting ? "Deleting…" : "Confirm"}
            </button>
          ) : (
            <button
              className="rounded-lg border border-rose-400/25 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:border-rose-300/50"
              onClick={props.onDelete}
              type="button"
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

const stateTone: Record<string, string> = {
  completed: "bg-emerald-400/10 text-emerald-300",
  failed: "bg-rose-400/10 text-rose-300",
  evidence_ready: "bg-sky-400/10 text-sky-300",
  analyzing: "bg-violet-400/10 text-violet-300",
  collecting: "bg-amber-400/10 text-amber-200",
  queued: "bg-white/[0.06] text-white/50",
};

function stateLabelFor(state: string): string {
  return state.replace(/_/g, " ");
}

function truncateUrl(url: string): string {
  return url.length > 96 ? `${url.slice(0, 93)}…` : url;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function NetworkBackdrop(): JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[20%] h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-r from-sky-500/[0.08] via-violet-500/[0.09] to-fuchsia-500/[0.08] blur-3xl" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/35 to-transparent" />
    </div>
  );
}
