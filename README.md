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
