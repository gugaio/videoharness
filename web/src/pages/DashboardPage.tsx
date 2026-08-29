import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@clerk/react";
import RequestsPanel from "../components/RequestsPanel";

export default function DashboardPage() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const query = new URLSearchParams(useLocation().search);
  const source = query.get("source") ?? undefined;
  const preset = query.get("preset") ?? undefined;
  const isProxy = !id;

  return <main className="min-h-screen bg-[#11100f] text-stone-100"><header className="border-b border-white/10"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10"><Link to="/workspace" className="text-sm font-medium text-white/65 transition hover:text-white">← Back to workspace</Link><span className="text-sm font-medium text-white">Stream dashboard</span></div></header><div className="mx-auto max-w-7xl px-6 py-12 lg:px-10"><h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">{isProxy ? "Live proxy dashboard" : "Clone dashboard"}</h1><p className="mt-3 text-sm text-stone-400">The 20 latest requests for this stream.</p><RequestsPanel getToken={getToken} mode={isProxy ? "proxy" : "clone"} streamId={id} source={source} preset={preset} /></div></main>;
}
