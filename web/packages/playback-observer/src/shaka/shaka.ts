import type { PlaybackAdapter } from "../types";

export interface ShakaPlayerLike extends EventTarget {
  getStats?: () => Record<string, unknown>;
}

function compact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 2) return undefined;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => compact(item, depth + 1));
  if (typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
    if (["data", "response", "request", "originalEvent"].includes(key)) continue;
    const next = compact(item, depth + 1);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function stats(player: ShakaPlayerLike): Record<string, unknown> {
  try { return compact(player.getStats?.()) as Record<string, unknown> ?? {}; } catch { return {}; }
}

// The adapter only relies on EventTarget, so consumers can keep shaka-player
// optional and the package does not pull it into non-Shaka bundles.
export function shakaAdapter(player: ShakaPlayerLike): PlaybackAdapter {
  return {
    attach(emit) {
      const on = (name: string, type: Parameters<typeof emit>[0]) => {
        const handler = (event: Event) => {
          const detail = (event as Event & { detail?: unknown }).detail;
          emit(type, { event: name, detail: compact(detail), stats: stats(player) });
        };
        player.addEventListener(name, handler);
        return () => player.removeEventListener(name, handler);
      };
      const removers = [
        on("loading", "manifest_loading"),
        on("loaded", "manifest_loaded"),
        on("buffering", "stall_detected"),
        on("adaptation", "adaptation"),
        on("mediaqualitychanged", "quality_changed"),
        on("gapjumped", "gap_jumped"),
        on("stalldetected", "stall_detected"),
		on("drmsessionupdate", "drm_session_updated"),
		on("keystatuschanged", "drm_key_status_changed"),
		on("expirationupdated", "drm_expiration_updated"),
        on("error", "shaka_error"),
      ];
	  const onDownload = (name: "downloadcompleted" | "downloadfailed") => {
		const handler = (event: Event) => {
		  const shaped = event as Event & { requestType?: unknown; detail?: Record<string, unknown> };
		  // Shaka's FakeEvent copies the dictionary fields directly onto the
		  // event. Some wrappers expose them under detail, so accept both forms.
		  const requestType = String(shaped.requestType ?? shaped.detail?.requestType ?? shaped.detail?.type ?? "").toLowerCase();
		  const license = requestType.includes("license") || requestType === "2";
		  emit(license ? (name === "downloadcompleted" ? "license_request_completed" : "license_request_failed") : (name === "downloadcompleted" ? "segment_downloaded" : "segment_download_failed"), { event: name, requestType, detail: compact(shaped.detail), stats: stats(player) });
		};
		player.addEventListener(name, handler);
		return () => player.removeEventListener(name, handler);
	  };
	  removers.push(onDownload("downloadcompleted"), onDownload("downloadfailed"));
      const buffering = (event: Event) => {
        const detail = (event as Event & { buffering?: boolean; detail?: { buffering?: boolean } }).detail;
        const active = detail?.buffering ?? (event as Event & { buffering?: boolean }).buffering;
        emit(active ? "stall_detected" : "stall_resolved", { event: "buffering", stats: stats(player) });
      };
      player.addEventListener("buffering", buffering);
      removers.push(() => player.removeEventListener("buffering", buffering));
      return () => { for (const remove of removers) remove(); };
    },
  };
}
