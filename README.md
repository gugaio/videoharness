# streammock

Clone, mock and test HLS/DASH streams.

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
