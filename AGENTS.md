# AGENTS.md

Go backend + React/Vite frontend for recording, mocking, and playing HLS streams. Backend lives at the repo root; frontend in `web/`.

## Project plan
- See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the product phases. The next planned phase is a persistent, self-contained HLS clone of up to 60 seconds; the current implementation is an on-demand proxy only.

## Commands
- `make backend` — run Go server on `:8080`
- `make dev` — backend + Vite dev server on `:5173`, proxying `/api` and `/s/` to `:8080`
- `make build` — build frontend into `web/dist` (runs `tsc -b && vite build`, so it typechecks)
- `make clean` — removes `web/dist` and `web/node_modules`
- `npm run build` in `web/packages/playback-observer` — build the published library into `web/packages/playback-observer/dist` (not needed for `make dev`/`make build`, which read the source directly).
- Run `go test ./...`, `go build ./...`, `go vet ./...`, and `make build` for the frontend.

## Frontend serving mode
The server always serves the compiled React SPA from `web/dist` (`registerFrontend` in `cmd/server/main.go`). If `web/dist` is missing, `GET /` returns 503 — run `make build` or `make dev` first. There is no server-rendered fallback; the Go `html/template` UI was removed.

## Frontend workspaces (npm)
- `web/` is an npm workspace root (`"workspaces": ["packages/*"]`). The reusable telemetry lib lives in `web/packages/playback-observer`, published as `@streammock/playback-observer` (scoped package, public via `publishConfig`).
- Subpaths: the root entry (player-agnostic core + `HTTPBatchTransport`) and `@streammock/playback-observer/hls` (the HLS.js adapter). `hls.js` is an **optional peer dependency** — only the `hls` subpath imports it, so non-HLS consumers don't pull it in.
- The app imports the package by name (`@streammock/playback-observer`, `@streammock/playback-observer/hls`), resolved to the package **source** via `resolve.alias` in `web/vite.config.ts` and `paths` in `web/tsconfig.app.json` — no pre-build needed for `make dev`/`make build`. `npm run build` in the package produces the publishable `dist/` (tsup, ESM+CJS+`.d.ts`).
- Publishing: `npm publish` inside `web/packages/playback-observer` (runs `prepublishOnly` → build + test). Verify the tarball with `npm pack --dry-run`.
- Adding an export/subpath requires updating `exports` in the package's `package.json` **and** the vite alias + tsconfig paths. Vite does prefix matching (no `$` exact-match) — keep the more specific subpath (`/hls`) before the root in the alias object.

## Auth (Clerk)
- Auth uses Clerk (`@clerk/react`, Core 2 SDK) in `web/`. The publishable key lives in `web/.env.local` (gitignored) and is auto-detected by `ClerkProvider` — do not commit or read it.
- `ClerkProvider` wraps `<App>` in `web/src/main.tsx`; auth controls (`Show` + `SignInButton`/`SignUpButton`/`UserButton`) live in the header in `web/src/App.tsx`.
- Only the frontend is gated: the `/dashboard` route is wrapped in `ProtectedRoute` (`web/src/components/ProtectedRoute.tsx`). The Go `/api/*` endpoints are **not** authenticated.
- This is a React SPA — no Next.js proxy/middleware matcher applies.

## Gotchas
- Run `go run ./cmd/server` from the repo root — `web/dist` is loaded via a relative path.
- Go module requires Go 1.27. SQLite via `modernc.org/sqlite` (pure Go, no CGO). DB is `streammock.db` (gitignored, WAL mode), auto-migrated, and seeded with a Big Buck Bunny demo stream on startup.
- Env vars: `STREAMMOCK_ADDR` (default `:8080`), `STREAMMOCK_DB` (default `streammock.db`), `STREAMMOCK_BBB_URL`, `STREAMMOCK_RATELIMIT_RPM` (default 10), `STREAMMOCK_RATELIMIT_BURST` (default 5), `STREAMMOCK_EPHEMERAL_TTL_MINUTES` (default 60), and `STREAMMOCK_ALLOW_PRIVATE_TARGETS=1` (disables SSRF protection for local dev/tests; integration tests that hit local httptest servers need it).
- Preset definitions are duplicated: the `Presets` list in `internal/models/stream.go` and the preset string constants + fault logic in `internal/proxy/chaos.go`. Adding/renaming a preset must update both, plus the frontend preset UI (`web/src/types.ts`).

## Architecture
- Streams persist to SQLite but are served from an in-memory `sync.Map` (`internal/store/memory.go`), loaded at startup.
- New streams are captured asynchronously as persistent HLS VOD clones (clear MPEG-TS only): default 60s, maximum 300s. Clone playback reads only local registered resources under `/s/{id}/...`; legacy proxy streams still rewrite every playlist URI to `/s/{id}/r/{base64url(target)}`.
- Public on-demand endpoint: `GET /p.m3u8?url=<hls>&preset=<preset>&duration=<60..300>` (also mounted at `/p`) proxies the source live with no signup and nothing recorded. Streams get deterministic IDs (`od-<sha256>`), live memory-only (`store.Add(st, false)`), never appear in workspaces, are rate limited per IP, and are swept when idle past `EphemeralTTL`. All outbound fetches (proxy + capture) go through `internal/pubnet`, which blocks private/loopback/link-local destinations unless opted out.
- Workspace boards: `GET /ws/{slug}/p.m3u8?...` (also `/ws/{slug}/p`, no auth — players can't send headers; unknown slug → 404) proxies on behalf of a registered workspace and logs every playback request. Each authenticated user owns exactly one workspace (`db.EnsureWorkspace`, random `ws-` slug). Requests aggregate per `(workspace, stream, target URL)` via upsert (hit_count/bytes grow, status/duration reflect latest hit) into `proxy_requests`; retention = 24h TTL + 1,000 rows per workspace (enforced by `retainProxyRequests` goroutine in main). Engine records via `WithRequestSink` only for streams with `WorkspaceSlug` set; public streams are never logged. Workspace stream IDs hash `slug+URL` so boards don't collide.
- HTTP API: `GET/POST /api/streams`, `GET /api/streams/{id}`, `POST /api/streams/{id}/preset`; public playback entry: `GET /p.m3u8`; workspace: `GET /api/workspace`, `GET /api/workspace/requests[?workspace=slug]` (auth required; foreign slug → 403).
- Playback routes set CORS `*` and answer OPTIONS preflight (browser HLS players on other origins).
