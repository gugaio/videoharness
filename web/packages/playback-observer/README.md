# @streammock/playback-observer

Browser playback telemetry observer for HTML5 media and HLS.js. Listens to native `<video>` events and (optionally) HLS.js events, normalizes everything into structured `ObserverEvent`s, and ships them in batches to your backend via a pluggable transport.

- Player-agnostic core (works with any `<video>` / `HTMLMediaElement`, including native Safari HLS).
- Optional HLS.js adapter behind the `@streammock/playback-observer/hls` subpath (so `hls.js` stays a lazy, optional peer dependency).
- Fail-open: telemetry errors never break playback.
- Zero runtime dependencies (the root entry has none; only the `hls` subpath imports `hls.js`).

## Install

```sh
npm install @streammock/playback-observer
```

For HLS.js sessions, install `hls.js` too (optional peer dependency):

```sh
npm install @streammock/playback-observer hls.js
```

## Usage

### HLS.js

```ts
import Hls from "hls.js";
import { observePlayback } from "@streammock/playback-observer";
import { hlsJsAdapter } from "@streammock/playback-observer/hls";

const video = document.querySelector("video")!;
const hls = new Hls();

const observer = observePlayback({
  media: video,
  adapter: hlsJsAdapter(hls),
  sessionId: "session-abc",
  ingestUrl: "/api/playback/events",
});

// Record playback intent *before* HLS.js starts loading the manifest
// so startup timing includes manifest load + parse.
observer.playRequested();
hls.loadSource(manifestUrl);
hls.attachMedia(video);

// On teardown:
observer.destroy();
hls.destroy();
```

### Native playback (no HLS.js)

```ts
import { observePlayback } from "@streammock/playback-observer";

const video = document.querySelector("video")!;
const observer = observePlayback({ media: video, ingestUrl: "/api/playback/events" });
observer.playRequested();
video.src = manifestUrl;
video.play();
```

### Custom transport

By default events are POSTed as JSON `{ events: [...] }` to `ingestUrl`, batched (20 events or 1500ms) with `keepalive`, plus a `sendBeacon` flush on page unload. Swap it out for any backend/protocol:

```ts
import { observePlayback, type ObserverEvent } from "@streammock/playback-observer";

const observer = observePlayback({
  media: video,
  context: { app: "catalog", player: "shaka" },
  transport: {
    enqueue(event: ObserverEvent) { mySink.send(event); },
    async flush() {},
    closeWithBeacon() { mySink.flushNow(); },
  },
});
```

## API

### `observePlayback(options): PlaybackObserver`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `media` | `HTMLMediaElement` | — | The media element to observe (required). |
| `adapter` | `PlaybackAdapter` | — | Player-specific adapter (e.g. `hlsJsAdapter`). |
| `sessionId` | `string` | — | Injected into every event payload as `session_id` for correlation. |
| `ingestUrl` | `string` | — | Where to POST batched events (used only when no `transport` is given). |
| `transport` | `Transport` | `HTTPBatchTransport` | Custom sink; overrides `ingestUrl`. |
| `context` | `Record<string, unknown>` | — | Extra fields merged into every event payload. |
| `observerName` | `string` | `"@streammock/playback-observer"` | Value reported in `session_started`. |

Returns a `PlaybackObserver`:

- `playRequested()` — call before starting playback; measures precise first frame via `requestVideoFrameCallback`.
- `flush(): Promise<void>` — flush queued events immediately.
- `destroy()` — idempotent; emits `session_ended`, flushes, removes all listeners.

### `hlsJsAdapter(hls)` (from `@streammock/playback-observer/hls`)

Returns a `PlaybackAdapter` that mirrors HLS.js events (`manifest_*`, `fragment_*`, `buffer_append*`, `level_*`, `fps_drop`, `stall_*`, `hls_error`) and sanitizes payloads (depth/array/size limits, sensitive fields stripped).

### Events

Core (player-agnostic): `session_started`, `session_ended`, `play_requested`, `first_frame`, `playing`, `buffering_started`, `buffering_ended`, `seek_started`, `seek_ended`, `paused`, `resumed`, `ended`, `media_error`, `visibility_changed`, `media_snapshot` (every 2s).

HLS.js adapter: `manifest_loading`, `manifest_loaded`, `manifest_parsed`, `fragment_loading`, `fragment_loaded`, `fragment_parsed`, `fragment_buffered`, `buffer_appended`, `buffer_append_error`, `level_switching`, `level_switched`, `emergency_downswitch`, `fps_drop`, `stall_detected`, `stall_resolved`, `hls_error`.

Each `ObserverEvent` carries `id`, `sequence_number`, `event_type`, `wall_time_ms`, `monotonic_ms`, and optional `media_time_ms`, `buffer_ahead_ms`, `bitrate_kbps`, `throughput_kbps`, `payload_json`.

## License

MIT