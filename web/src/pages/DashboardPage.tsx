import { useAuth } from "@clerk/react";
import { Link, useLocation, useParams } from "react-router-dom";
import RequestsPanel from "../components/RequestsPanel";
import PlaybackInspector from "../components/PlaybackInspector";

export default function DashboardPage() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const query = new URLSearchParams(useLocation().search);
  const source = query.get("source") ?? undefined;
  const preset = query.get("preset") ?? undefined;
  const isProxy = !id;

  const previewParams = new URLSearchParams();
  if (source) previewParams.set("source", source);
  if (preset) previewParams.set("preset", preset);
  const previewPath = source ? `/preview/proxy?${previewParams.toString()}` : null;

  return (
    <main className="min-h-screen bg-[#11100f] text-stone-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <Link to="/workspace" className="text-sm font-medium text-white/65 transition hover:text-white">
            ← Back to workspace
          </Link>
          <span className="text-sm font-medium text-white">Stream dashboard</span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">
              {isProxy ? "Live proxy dashboard" : "Clone dashboard"}
            </h1>
            <p className="mt-3 text-sm text-stone-400">The 20 latest requests for this stream.</p>
          </div>

          {isProxy && previewPath && (
            <a
              href={previewPath}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              Open player preview
              <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>

        <RequestsPanel
          getToken={getToken}
          mode={isProxy ? "proxy" : "clone"}
          streamId={id}
          source={source}
          preset={preset}
        />
		<PlaybackInspector getToken={getToken} streamId={id} source={source} preset={preset} />
      </div>
    </main>
  );
}
