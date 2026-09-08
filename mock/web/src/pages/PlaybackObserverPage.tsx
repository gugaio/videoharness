import { useState } from "react";
import { Link } from "react-router-dom";

const AGENT_PROMPT = `You are integrating the @streammock/playback-observer library into an HLS.js player project.

Task: instrument playback with the observer so the backend receives a structured playback timeline (events), correlated by session_id.

Steps:
1. Install: npm install @streammock/playback-observer hls.js
2. Import the core observer and the HLS.js adapter:
   import { observePlayback } from "@streammock/playback-observer";
   import { hlsJsAdapter } from "@streammock/playback-observer/hls";
3. Create the observer BEFORE loading the manifest, passing:
   - media: the <video> element
   - adapter: hlsJsAdapter(hls)
   - sessionId: a correlation id (reuse the CMCD session id when available)
   - ingestUrl: the backend endpoint that accepts POST JSON { events: [...] }
4. Call observer.playRequested() BEFORE hls.loadSource() so startup timing includes manifest load + parse.
5. Wire hls.loadSource(url) / hls.attachMedia(video) / video.play() as usual.
6. On player teardown, call observer.destroy() and hls.destroy().
7. Optionally pass context: { ... } to attach product metadata to every event payload.
8. Native fallback (no MSE, e.g. Safari): observePlayback({ media, sessionId, ingestUrl }) WITHOUT the adapter.
9. Telemetry is fail-open: never let observer errors break playback.

Constraints:
- Create one observer per stream session, kept as a peer of the Hls instance.
- Use only the provided ingestUrl (or a custom transport) — never send events elsewhere.
- Do not add comments to the code.`;

const checklist = [
  "Create the observer before loadSource()",
  "Call playRequested() before video.play()",
  "Call observer.destroy() + hls.destroy() on teardown",
  "Backend accepts POST JSON { events: [...] } on ingestUrl",
  "Reuse the CMCD session id as sessionId for correlation",
  "Telemetry must never block playback (fail-open)",
];

export default function PlaybackObserverPage() {
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#11100f] text-stone-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6 lg:px-10">
          <Link to="/about" className="text-sm font-medium text-white/65 transition hover:text-white">
            ← Back to About
          </Link>
          <span className="text-sm font-medium text-white">Playback observer</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10">
        <section className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.16em] text-amber-100/60">Agent instructions</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            Configure the Playback Observer with HLS.js
          </h1>
          <p className="mt-5 text-base leading-relaxed text-stone-300/80">
            Paste the prompt below into any AI coding agent to instrument your player with
            <span className="font-mono text-stone-200"> @streammock/playback-observer</span>. The
            observer listens to native video and HLS.js events, normalizes them, and ships them in
            batches to your backend — correlated by <span className="font-mono text-stone-200">session_id</span>.
          </p>
        </section>

        <section className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.07] shadow-2xl shadow-black/20 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full bg-amber-100" />
              <h2 className="text-sm font-semibold tracking-wide text-white">agent-prompt.md</h2>
            </div>
            <button
              type="button"
              onClick={copyPrompt}
              className="rounded-xl border border-white/10 bg-black/25 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-amber-100/60"
            >
              {copied ? "Copied ✓" : "Copy prompt"}
            </button>
          </div>
          <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap px-6 py-6 font-mono text-xs leading-relaxed text-stone-300">
            {AGENT_PROMPT}
          </pre>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
            <h2 className="text-lg font-semibold text-white">Acceptance checklist</h2>
            <ul className="mt-4 space-y-3">
              {checklist.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-stone-300/80">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-amber-100/40 text-[10px] text-amber-100">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
            <h2 className="text-lg font-semibold text-white">Events you get back</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-300/80">
              Core playback: <span className="font-mono text-xs text-stone-200">playing</span>,{" "}
              <span className="font-mono text-xs text-stone-200">buffering_started/ended</span>,{" "}
              <span className="font-mono text-xs text-stone-200">seek_*</span>,{" "}
              <span className="font-mono text-xs text-stone-200">first_frame</span>,{" "}
              <span className="font-mono text-xs text-stone-200">paused/resumed</span>,{" "}
              <span className="font-mono text-xs text-stone-200">media_error</span>, snapshots every 2s.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-stone-300/80">
              HLS.js adapter: <span className="font-mono text-xs text-stone-200">manifest_*</span>,{" "}
              <span className="font-mono text-xs text-stone-200">fragment_*</span>,{" "}
              <span className="font-mono text-xs text-stone-200">level_*</span>,{" "}
              <span className="font-mono text-xs text-stone-200">fps_drop</span>,{" "}
              <span className="font-mono text-xs text-stone-200">stall_*</span>,{" "}
              <span className="font-mono text-xs text-stone-200">hls_error</span>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}