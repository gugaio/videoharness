import { Link, useNavigate } from "react-router-dom";

const samples = [
  { id: "delay", title: "Slow manifest", label: "Delay", description: "Adds a deterministic 3-second delay to manifest requests. Useful for startup and retry behavior." },
  { id: "http-error", title: "Intermittent segment 503", label: "1 every 4", description: "Returns 503 on every fourth video-segment request. The other three requests are delivered normally." },
  { id: "http-404", title: "Intermittent segment 404", label: "1 every 4", description: "Returns 404 on every fourth video-segment request, for clients that distinguish missing content from a transient server error." },
  { id: "truncated", title: "Truncated video chunks", label: "Corruption", description: "Delivers shortened video-segment bodies. This tests parser/decode recovery, not a real network packet loss simulation." },
] as const;

export function SamplesPage(): JSX.Element {
  const navigate = useNavigate();
  return <main className="min-h-screen bg-harness-bg px-5 pb-12 pt-6 text-harness-text sm:px-8 lg:px-12">
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between"><Link className="text-sm font-semibold text-white/85" to="/">Video Harness Space</Link><span className="flex gap-4"><Link className="text-sm text-sky-200 hover:text-white" to="/recordings">Recordings</Link><Link className="text-sm text-sky-200 hover:text-white" to="/record">Record VOD</Link></span></header>
    <section className="mx-auto mt-16 w-full max-w-5xl">
      <p className="text-xs font-medium uppercase tracking-[.25em] text-sky-200/70">Reference fault lab · v1</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Resilience samples.</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-harness-muted">Choose a deterministic request-failure scenario, then record a compatible VOD. The scenario is applied to its local playback URL and every applied rule is kept in the request journal.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{samples.map((sample) => <article className="rounded-3xl border border-white/10 bg-white/[.04] p-6" key={sample.id}>
        <span className="rounded-full border border-sky-300/20 bg-sky-300/[.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-100">{sample.label}</span>
        <h2 className="mt-5 text-xl font-semibold">{sample.title}</h2><p className="mt-2 min-h-20 text-sm leading-6 text-harness-muted">{sample.description}</p>
        <button className="mt-6 w-full rounded-xl bg-white/[.09] px-4 py-3 text-sm font-semibold transition hover:bg-sky-200 hover:text-slate-950" onClick={() => navigate(`/record?sample=${sample.id}`)}>Use this sample</button>
      </article>)}</div>
      <p className="mt-8 max-w-3xl rounded-2xl border border-amber-300/15 bg-amber-300/[.04] p-4 text-sm leading-6 text-amber-100/80">v1 covers delivery faults only. It does not yet generate a self-contained A/V reference asset, black-screen, silent-audio, lip-sync or real DNS-failure scenarios; request evidence never proves rendered frames or decoded audio.</p>
    </section>
  </main>;
}
