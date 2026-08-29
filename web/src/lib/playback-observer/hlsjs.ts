import Hls, { Events } from "hls.js";
import type { PlaybackAdapter, ObserverEventType } from "./types";

function compact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 2) return undefined;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => compact(item, depth + 1));
  if (typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
    if (["payload", "data1", "data2", "networkDetails"].includes(key)) continue;
    const next = compact(item, depth + 1);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function hlsJsAdapter(hls: Hls): PlaybackAdapter {
  return {
    attach(emit) {
	  const removers: Array<() => void> = [];
	  let stalled = false;
      const on = (event: Events, type: ObserverEventType) => {
		const handler = (_name: unknown, data: unknown) => emit(type, compact(data) as Record<string, unknown>);
		hls.on(event, handler as never);
		removers.push(() => hls.off(event, handler as never));
      };
      on(Hls.Events.MANIFEST_LOADING, "manifest_loading");
      on(Hls.Events.MANIFEST_LOADED, "manifest_loaded");
      on(Hls.Events.MANIFEST_PARSED, "manifest_parsed");
      on(Hls.Events.FRAG_LOADING, "fragment_loading");
      on(Hls.Events.FRAG_LOADED, "fragment_loaded");
      on(Hls.Events.FRAG_PARSED, "fragment_parsed");
	  const bufferedHandler = ((_name: unknown, data: unknown) => {
		emit("fragment_buffered", compact(data) as Record<string, unknown>);
		if (stalled) { stalled = false; emit("stall_resolved", { evidence: "fragment_buffered" }); }
	  });
	  hls.on(Hls.Events.FRAG_BUFFERED, bufferedHandler);
	  removers.push(() => hls.off(Hls.Events.FRAG_BUFFERED, bufferedHandler));
      on(Hls.Events.BUFFER_APPENDED, "buffer_appended");
      on(Hls.Events.LEVEL_SWITCHING, "level_switching");
      on(Hls.Events.LEVEL_SWITCHED, "level_switched");
      on(Hls.Events.FPS_DROP, "fps_drop");
      const errorHandler = ((_name: unknown, data: { type?: string; details?: string; fatal?: boolean; frag?: unknown }) => {
        const payload = compact(data) as Record<string, unknown>;
		if (data.details === "bufferStalledError") { stalled = true; emit("stall_detected", payload); }
        if (data.details?.toLowerCase().includes("append")) emit("buffer_append_error", payload);
        if (data.details?.toLowerCase().includes("emergency")) emit("emergency_downswitch", payload);
        emit("hls_error", payload);
	  });
	  hls.on(Hls.Events.ERROR, errorHandler);
	  removers.push(() => hls.off(Hls.Events.ERROR, errorHandler));
	  return () => { for (const remove of removers) remove(); };
    },
  };
}
