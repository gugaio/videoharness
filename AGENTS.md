# AGENTS.md

Go backend + React/Vite frontend for recording, mocking, and playing HLS streams. Backend lives at the repo root; frontend in `web/`.

## Project plan
- See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the product phases. The next planned phase is a persistent, self-contained HLS clone of up to 60 seconds; the current implementation is an on-demand proxy only.

## Commands
- `make backend` — run Go server on `:8080`
- `make dev` — backend + Vite dev server on `:5173`, proxying `/api` and `/s/` to `:8080`
- `make build` — build frontend into `web/dist` (runs `tsc -b && vite build`, so it typechecks)
- `make clean` — removes `web/dist` and `web/node_modules`
- No tests exist. Verify with `go build ./...`, `go vet ./...`, and `make build` for the frontend.

## Frontend serving mode
The server always serves the compiled React SPA from `web/dist` (`registerFrontend` in `cmd/server/main.go`). If `web/dist` is missing, `GET /` returns 503 — run `make build` or `make dev` first. There is no server-rendered fallback; the Go `html/template` UI was removed.

## Auth (Clerk)
- Auth uses Clerk (`@clerk/react`, Core 2 SDK) in `web/`. The publishable key lives in `web/.env.local` (gitignored) and is auto-detected by `ClerkProvider` — do not commit or read it.
- `ClerkProvider` wraps `<App>` in `web/src/main.tsx`; auth controls (`Show` + `SignInButton`/`SignUpButton`/`UserButton`) live in the header in `web/src/App.tsx`.
- Only the frontend is gated: the `/dashboard` route is wrapped in `ProtectedRoute` (`web/src/components/ProtectedRoute.tsx`). The Go `/api/*` endpoints are **not** authenticated.
- This is a React SPA — no Next.js proxy/middleware matcher applies.

## Gotchas
- Run `go run ./cmd/server` from the repo root — `web/dist` is loaded via a relative path.
- Go module requires Go 1.27. SQLite via `modernc.org/sqlite` (pure Go, no CGO). DB is `streammock.db` (gitignored, WAL mode), auto-migrated, and seeded with a Big Buck Bunny demo stream on startup.
- Env vars: `STREAMMOCK_ADDR` (default `:8080`), `STREAMMOCK_DB` (default `streammock.db`), `STREAMMOCK_BBB_URL`.
- Preset definitions are duplicated: the `Presets` list in `internal/models/stream.go` and the preset string constants + fault logic in `internal/proxy/chaos.go`. Adding/renaming a preset must update both, plus the frontend preset UI (`web/src/types.ts`).

## Architecture
- Streams persist to SQLite but are served from an in-memory `sync.Map` (`internal/store/memory.go`), loaded at startup.
- The HLS proxy (`internal/proxy/engine.go`) serves `/s/{id}/master.m3u8` and rewrites every playlist URI to `/s/{id}/r/{base64url(target)}`. Playlists are truncated to a 60s window (`TruncateSeconds` in `internal/config`) and closed with `#EXT-X-ENDLIST`.
- HTTP API: `GET/POST /api/streams`, `GET /api/streams/{id}`, `POST /api/streams/{id}/preset`.
