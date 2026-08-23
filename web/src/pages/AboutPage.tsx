import { Link } from "react-router-dom";
import { UserButton, useAuth } from "@clerk/react";
import { Show } from "@clerk/react";
import { DEFAULT_PRESETS } from "../types";

const steps = [
  {
    n: "01",
    title: "Paste your stream URL",
    body: "Grab any HLS or DASH manifest URL — your own, a test asset, or the Big Buck Bunny demo — and paste it into the clone box.",
  },
  {
    n: "02",
    title: "Clone it once",
    body: "Stream Mock creates a player-ready proxy URL and keeps it saved in your workspace so you can reuse it any time.",
  },
  {
    n: "03",
    title: "Pick a playback preset",
    body: "Apply a preset to simulate real network conditions like degraded CDNs, subway connections, or stale manifests.",
  },
  {
    n: "04",
    title: "Test in your own player",
    body: "Copy the proxy URL into any HLS/DASH player and reproduce the condition again and again. Perfect for Dev and QA.",
  },
];

export default function AboutPage() {
  const { isSignedIn } = useAuth();

  return (
    <main className="min-h-screen overflow-hidden bg-[#11100f] text-stone-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,rgba(116,83,60,0.35),transparent_68%)]" />

      <header className="relative border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <Link to="/" className="text-xl font-medium tracking-[-0.04em] text-white">
            Stream Mock
          </Link>
          <div className="flex items-center gap-5">
            <Link to={isSignedIn ? "/workspace" : "/"} className="text-sm font-medium text-white/65 transition hover:text-white">
              ← Back {isSignedIn ? "to workspace" : "home"}
            </Link>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <section className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.16em] text-amber-100/60">About</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            What is Stream Mock?
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-stone-300/80">
            Stream Mock is an all-in-one HLS and DASH player simulator. It clones a
            live stream once and lets you replay it under any network condition, so
            developers and QA teams can test playback behavior without hunting for
            a real degraded stream every time.
          </p>
        </section>

        <section className="mt-14 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl text-stone-900">✦</div>
            <h2 className="mt-4 text-lg font-semibold text-white">The idea</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-300/80">
              Streaming bugs usually appear only under specific conditions — a
              slow network, a failing CDN, a stale manifest. Instead of waiting for
              those moments, Stream Mock simulates them on demand. Clone the stream
              once, then break it however you want.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl text-stone-900">▶</div>
            <h2 className="mt-4 text-lg font-semibold text-white">Playback presets</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-300/80">
              Each preset alters how the proxy behaves. Apply one and refresh the
              playlist — no redeploys, no waiting on a bad connection.
            </p>
            <ul className="mt-4 space-y-3">
              {DEFAULT_PRESETS.map((preset) => (
                <li key={preset.key} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-sm font-semibold text-white">{preset.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-stone-400">{preset.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">How to use it</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {steps.map((step) => (
              <div key={step.n} className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
                <span className="font-mono text-sm text-amber-100/60">{step.n}</span>
                <h3 className="mt-3 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-300/80">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.1] to-white/[0.04] p-7 text-center sm:p-10">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
            No stream handy? Try the demo
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-stone-300/80">
            The Big Buck Bunny demo is seeded on startup. Clone it, apply a preset,
            and see the condition in action.
          </p>
          <Link
            to="/stream/big-buck-bunny"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60"
          >
            Try the demo →
          </Link>
        </section>
      </div>
    </main>
  );
}