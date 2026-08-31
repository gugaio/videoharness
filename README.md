# streammock

Clone, mock and test HLS/DASH streams, including test-only ClearKey playback.

## Streaming formats

StreamMock proxies HLS (`.m3u8`) and DASH (`.mpd`) through public or
workspace-scoped endpoints. Persistent HLS clones can retain either the
highest-bandwidth rendition or the complete VOD ladder, including alternate
audio and WebVTT subtitles. MPEG-TS, fragmented MP4 (`EXT-X-MAP`) and HLS byte
ranges are materialized into self-contained local files.

Live HLS inputs are frozen as ordinary local VODs: StreamMock selects the most
recent complete segments that fit the requested duration, aligns renditions by
`EXT-X-PROGRAM-DATE-TIME` or media sequence when possible, stays inside the
latest discontinuity epoch, and writes `#EXT-X-ENDLIST`. LL-HLS parts and
preload hints are intentionally ignored; delta-playlist `EXT-X-SKIP` sequence
offsets are applied to the complete segments that remain. Capture does not wait
for future segments, so the result may be shorter than requested when the
origin's current window is shorter.

DASH clones support clear, static MPDs with one Period and
`SegmentTemplate`/`SegmentTimeline`. Dynamic MPDs, multiple Periods,
`SegmentBase`-only clones, encrypted inputs and unavailable HLS gap segments
fail explicitly instead of publishing a partial clone.

- Public: /p.m3u8?url=… and /p.mpd?url=…
- Workspace: /ws/{slug}/p.m3u8?url=… and /ws/{slug}/p.mpd?url=…
- Local clear clones: `/s/{id}/master.m3u8` or `/s/{id}/manifest.mpd`
- Local HLS live mock: `/s/{id}/live.m3u8` (a ready clear HLS clone, started
  through the workspace dashboard or `POST /api/streams/{id}/live`)
- Local ClearKey clones: `/s/{id}/manifest.mpd`
- ClearKey license: `POST /s/{id}/license/clearkey`

The built-in preview uses HLS.js for clear HLS and Shaka Player for DASH and
ClearKey. Both feed the Playback Inspector; DRM session, key status and license
request events are included in the timeline. CMCD remains query-parameter v1;
CMCD v2 and request headers are intentionally outside this MVP.

## Local HLS live mocks

Any ready clear HLS clone can become a local rolling live source. Start it from
the clone dashboard, then use `/s/{id}/live.m3u8`; the generated master and
media playlists reference only stored clone files. The dashboard can pause,
resume, restart, or stop the scenario. It starts with a three-segment window,
loops by default, and accepts a 1–20 segment window through the control API.

Live state is intentionally process-local. Restarting StreamMock resets the
scenario rather than attempting to resume a wall-clock run. This first cut is
HLS-only: it does not create DASH dynamic manifests, LL-HLS parts, or a
continuous ingest from an upstream live origin.

## ClearKey test clones

Choose **ClearKey (test DRM)** while creating an HLS clone. StreamMock captures
all available video, alternate audio and WebVTT subtitle tracks, generates one
random 128-bit KID/key pair per clone, packages the audio/video tracks as
CENC/fMP4, and produces a static DASH manifest for playback. The frontend
configures `org.w3.clearkey` automatically with the clone's local license URL.

Shaka Packager must be available as `packager` on `PATH`, or configured with
`STREAMMOCK_PACKAGER_BIN`. The Docker image already contains the pinned,
checksum-verified Packager binary. A local source build can use the official
binary or Docker image and then run:

```bash
make build
make backend
```

Open `http://localhost:8080/dashboard`, create a clone, wait for `ready`, and
open its preview. ClearKey is intended only for deterministic browser/player
tests: keys are stored in the local SQLite database and are delivered without
authentication to anyone who has the playback URL. It is not content security,
license expiry, key rotation, Widevine, FairPlay or PlayReady. Use HTTPS (or
localhost) because production EME playback requires a secure browser context.

DRM-specific chaos presets cover license latency, failure, fail-then-recover,
wrong keys and malformed license responses.

## Storage and lifecycle

Clone publication is atomic: downloads are staged, inventoried, quota-checked,
then moved to the local clone directory. Deletion first moves data to a private
trash directory so a database failure can restore it. A background janitor
removes expired clones, stale staging/trash directories and old orphan clone
directories.

Relevant environment variables (see `.env.example`):

- `STREAMMOCK_CLONE_MAX_BYTES` — maximum bytes per clone (default 1 GiB).
- `STREAMMOCK_USER_QUOTA_BYTES` — aggregate clone bytes per owner (default 5 GiB; `0` disables the quota).
- `STREAMMOCK_CLONE_TTL_HOURS` — clone expiry; `0` disables expiry.
- `STREAMMOCK_CLONE_JANITOR_MINUTES` — cleanup cadence (default 30).
- `STREAMMOCK_PACKAGER_BIN` and `STREAMMOCK_PACKAGER_TIMEOUT_MINUTES`.
- `STREAMMOCK_LICENSE_RATELIMIT_RPM` and `STREAMMOCK_LICENSE_RATELIMIT_BURST`.

## Deploy with Docker Compose

1. Create your deployment environment file: `cp .env.example .env`.
2. Set the Clerk publishable and secret keys in `.env`.
3. Start the application: `docker compose up -d --build`.

The app is then available at `http://localhost:8080` (or `STREAMMOCK_PORT`).
The SQLite database is stored in the `streammock-data` named volume, so it
survives container recreations. Back up that volume before host migrations.

For a public deployment, place a TLS reverse proxy in front of port 8080 and
configure the deployed domain in Clerk's allowed origins and redirect URLs.

## Production deploy with GitHub Actions and Coolify

Pushes to `main` build a multi-architecture image, publish it as
`ghcr.io/gugaio/streammock:latest`, and then trigger a Coolify deploy. Pull
requests build the same image without publishing it. The CI workflow also runs
`go build ./...`, `go vet ./...`, and the production frontend build.

Configure these GitHub repository secrets:

- `VITE_CLERK_PUBLISHABLE_KEY` — public Clerk key embedded in the React bundle.
- `COOLIFY_WEBHOOK_URL` — the Git deploy webhook copied from Coolify. If it is
  absent, image publishing still succeeds and the deploy step is skipped.

In Coolify, create a Docker Compose resource using `compose.prod.yaml`, expose
the `streammock` service on port `8080`, and configure:

- `CLERK_SECRET_KEY` as a runtime secret.
- `STREAMMOCK_BBB_URL` only when overriding the default demo stream.

The production Compose always pulls the newest image and persists SQLite in the
`streammock-data` volume. If the GHCR package is private, configure Coolify with
GitHub Container Registry credentials that can read the package. Back up the
volume before migrating the deployment to another server.
