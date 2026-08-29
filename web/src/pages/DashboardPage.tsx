import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { getWorkspace } from "../api";
import RequestsPanel from "../components/RequestsPanel";

export default function DashboardPage() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const query = new URLSearchParams(useLocation().search);
  const source = query.get("source") ?? undefined;
  const preset = query.get("preset") ?? undefined;
  const isProxy = !id;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackURL, setPlaybackURL] = useState<string | null>(null);

  useEffect(() => {
    if (!isProxy || !source) return;
    getToken().then(async (token) => {
      const workspace = await getWorkspace(token ?? undefined);
      const params = new URLSearchParams({ url: source });
      if (preset && preset !== "clean") params.set("preset", preset);
      setPlaybackURL(`${workspace.playback_url}?${params.toString()}`);
    }).catch(() => setPlaybackURL(null));
  }, [getToken, isProxy, preset, source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackURL) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(playbackURL);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = playbackURL;
  }, [playbackURL]);

  return <main className="min-h-screen bg-[#11100f] text-stone-100"><header className="border-b border-white/10"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10"><Link to="/workspace" className="text-sm font-medium text-white/65 transition hover:text-white">← Back to workspace</Link><span className="text-sm font-medium text-white">Stream dashboard</span></div></header><div className="mx-auto max-w-7xl px-6 py-12 lg:px-10"><h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">{isProxy ? "Live proxy dashboard" : "Clone dashboard"}</h1><p className="mt-3 text-sm text-stone-400">The 20 latest requests for this stream.</p>{isProxy && <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-black/20"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold text-white">Preview</h2><p className="mt-1 text-sm text-stone-400">Play the live proxy and watch its requests appear below.</p></div><video ref={videoRef} controls playsInline className="aspect-video w-full bg-black" /></section>}<RequestsPanel getToken={getToken} mode={isProxy ? "proxy" : "clone"} streamId={id} source={source} preset={preset} /></div></main>;
}
