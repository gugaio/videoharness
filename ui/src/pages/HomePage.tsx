import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getHealth } from "../lib/api";

const modules = [
  {
    title: "Record & Replay",
    description: "Record a bounded VOD locally, then replay it under controlled network, failure, and recovery scenarios.",
    icon: <RecordIcon />,
    available: true,
    path: "/record",
  },
  {
    title: "Investigate",
    description: "Turn a stream URL and reported symptom into a clear, evidence-backed diagnosis.",
    icon: <SearchIcon />,
    available: true,
    path: "/investigations",
  },
  {
    title: "Watch",
    description: "Monitor a live stream 24/7 and detect problems.",
    icon: <WatchIcon />,
    available: false,
    path: undefined,
  },
  {
    title: "Replay",
    description: "Replay incidents with collected evidence.",
    icon: <ReplayIcon />,
    available: false,
    path: undefined,
  },
] as const;

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 15_000,
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (url.trim()) navigate(`/record?url=${encodeURIComponent(url.trim())}`);
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
              Controlled streaming playback
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-6xl lg:text-[72px]">
              Record any video
              <br className="hidden sm:block" /> stream and{" "}
              <span className="bg-gradient-to-r from-sky-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                replay it under control.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-harness-muted sm:text-lg">
              Clone a VOD locally once, then replay it any day under simulated network, failure, and recovery conditions.
            </p>
          </div>

          <form className="mx-auto mt-10 w-full max-w-3xl" onSubmit={submit}>
            <label className="sr-only" htmlFor="stream-url">Stream URL</label>
            <div className="rounded-2xl border border-sky-200/35 bg-white/[0.085] p-1.5 shadow-[0_12px_38px_rgba(56,189,248,0.12)] backdrop-blur-xl transition focus-within:border-sky-200/75 focus-within:shadow-[0_12px_42px_rgba(56,189,248,0.2)]">
              <input
                id="stream-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="h-14 w-full rounded-xl bg-white/[0.09] px-5 font-mono text-sm text-white outline-none placeholder:text-white/50 focus:bg-white/[0.12] sm:text-base"
                placeholder="https://example.com/vod/master.m3u8"
                type="url"
              />
            </div>

            <button
              className="mt-5 h-16 w-full rounded-2xl border border-white/35 bg-gradient-to-r from-cyan-200 via-sky-300 to-violet-300 text-base font-bold tracking-tight text-slate-950 shadow-[0_14px_38px_rgba(56,189,248,0.28)] transition hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_18px_44px_rgba(129,140,248,0.34)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200/30 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
              disabled={!url.trim() || health.data?.ok !== true}
              type="submit"
            >
              Set up recording
            </button>
            <p className="mt-3 text-xs leading-5 text-white/45">Choose the protocol, window, and playback scenario on the next screen.</p>
          </form>

          <div className="mx-auto mt-14 w-full max-w-5xl text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/65">Explore all workflows</p>
            <p className="mt-2 text-sm text-white/50">Record and replay streams under control, or run an AI-powered investigation.</p>
          </div>
          <div className="mx-auto mt-5 grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((module) => (
              <ModuleCard key={module.title} onOpen={module.path ? () => navigate(module.path) : undefined} {...module} />
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
  onOpen?: () => void;
}): JSX.Element {
  return (
    <article onClick={props.onOpen} onKeyDown={(event) => { if (props.onOpen && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); props.onOpen(); } }} role={props.onOpen ? "button" : undefined} tabIndex={props.onOpen ? 0 : undefined}
      className={`rounded-2xl border p-5 text-left backdrop-blur-xl transition ${
        props.available
          ? "cursor-pointer border-white/20 bg-white/[0.075] shadow-panel hover:border-sky-200/40"
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
