import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getHealth, startInvestigation } from "../lib/api";

const modules = [
  {
    title: "Investigate",
    description: "Investigate a stream immediately.",
    icon: <SearchIcon />,
    available: true,
  },
  {
    title: "Record",
    description: "Continuously record streams for future analysis.",
    icon: <RecordIcon />,
    available: false,
  },
  {
    title: "Watch",
    description: "Monitor a live stream 24/7 and detect problems.",
    icon: <WatchIcon />,
    available: false,
  },
  {
    title: "Replay",
    description: "Replay incidents with collected evidence.",
    icon: <ReplayIcon />,
    available: false,
  },
] as const;

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [problemDescription, setProblemDescription] = useState("");
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 15_000,
  });
  const start = useMutation({
    mutationFn: () => startInvestigation({
      url,
      ...(problemDescription.trim() ? { problemDescription: problemDescription.trim() } : {}),
    }),
    onSuccess: ({ investigation }) => {
      navigate(`/investigations/${encodeURIComponent(investigation.id)}`);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (url.trim() && !start.isPending) start.mutate();
  }

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

        <section className="flex flex-1 flex-col justify-center py-16 sm:py-20">
          <div className="mx-auto w-full max-w-4xl text-center">
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.28em] text-white/40">
              AI-powered streaming investigations
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-6xl lg:text-[72px]">
              Investigate any video
              <br className="hidden sm:block" /> stream{" "}
              <span className="bg-gradient-to-r from-sky-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                in seconds.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-harness-muted sm:text-lg">
              Paste a URL and a team of AI agents analyzes playback, network, media and compatibility issues — live, in front of you.
            </p>
          </div>

          <form className="mx-auto mt-10 w-full max-w-3xl" onSubmit={submit}>
            <label className="sr-only" htmlFor="stream-url">Stream URL</label>
            <div className="rounded-2xl border border-white/20 bg-black/30 p-1.5 shadow-glow backdrop-blur-xl focus-within:border-white/45">
              <input
                id="stream-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="h-14 w-full rounded-xl bg-white/[0.055] px-5 font-mono text-sm text-white outline-none placeholder:text-white/30 sm:text-base"
                placeholder="https://example.com/live/master.m3u8"
                type="url"
              />
            </div>

            <label className="mt-5 block text-left text-sm text-white/65" htmlFor="problem-description">
              Problem description <span className="text-white/30">(optional)</span>
            </label>
            <textarea
              id="problem-description"
              value={problemDescription}
              onChange={(event) => setProblemDescription(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-5 py-4 text-sm text-white outline-none backdrop-blur-xl placeholder:text-white/25 focus:border-white/30"
              placeholder="My live freezes after 15 minutes on Samsung TVs."
            />
            <button
              className="mt-5 h-14 w-full rounded-2xl bg-gradient-to-r from-sky-300 via-violet-300 to-fuchsia-300 text-base font-semibold text-[#0a0c12] shadow-lg shadow-violet-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!url.trim() || health.data?.ok !== true || start.isPending}
              type="submit"
            >
              {start.isPending ? "Opening investigation…" : "Investigate"}
            </button>
            {start.error && <p className="mt-3 text-sm text-rose-300">{start.error.message}</p>}
          </form>

          <div className="mx-auto mt-10 grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((module) => (
              <ModuleCard key={module.title} {...module} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ModuleCard(props: {
  title: string;
  description: string;
  icon: ReactNode;
  available: boolean;
}): JSX.Element {
  return (
    <article
      className={`rounded-2xl border p-5 text-left backdrop-blur-xl transition ${
        props.available
          ? "border-white/20 bg-white/[0.075] shadow-panel"
          : "border-white/10 bg-white/[0.025]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07] text-white/70">
          {props.icon}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
            props.available ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.06] text-white/40"
          }`}
        >
          {props.available ? "Available now" : "Coming soon"}
        </span>
      </div>
      <h2 className="mt-5 text-lg font-medium">{props.title}</h2>
      <p className="mt-2 text-sm leading-5 text-harness-muted">{props.description}</p>
    </article>
  );
}

function NetworkBackdrop(): JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[30%] h-[520px] w-[1100px] -translate-x-1/2 animate-aurora-drift rounded-full bg-gradient-to-r from-sky-500/[0.09] via-violet-500/[0.1] to-fuchsia-500/[0.08] blur-3xl" />
      <div className="network-grid absolute inset-x-0 top-[33%] h-[440px] opacity-55" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/35 to-transparent" />
    </div>
  );
}

function Icon(props: { children: ReactNode }): JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19">
      {props.children}
    </svg>
  );
}

function SearchIcon(): JSX.Element {
  return <Icon><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" /><path d="m16.5 16.5 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></Icon>;
}

function RecordIcon(): JSX.Element {
  return <Icon><rect height="13" rx="3" stroke="currentColor" strokeWidth="1.7" width="15" x="3" y="5.5" /><path d="m18 10 3-2v8l-3-2" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" /></Icon>;
}

function WatchIcon(): JSX.Element {
  return <Icon><rect height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="18" x="3" y="4" /><path d="M8 21h8M12 18v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></Icon>;
}

function ReplayIcon(): JSX.Element {
  return <Icon><path d="M4 9V4m0 0h5M4 4l3.2 3.2A8 8 0 1 1 4.3 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></Icon>;
}
