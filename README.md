# Video Harness Space

Video Harness Space (VHS) e um workspace assistido por IA para investigar
problemas em sistemas de video streaming.

O MVP preserva o fluxo de investigacao e agora fecha um primeiro loop controlado:

```text
URL -> deterministic evidence -> hypotheses -> controlled clones
    -> same device URL -> attributed results -> conclusion or follow-up
```

A fundacao executavel inclui API Fastify, worker Node.js, PostgreSQL, UI
React/Vite, Record HLS/DASH VOD e Experiments sobre as mesmas fronteiras.

## Documentacao

Comece por:

- [`AGENTS.md`](AGENTS.md)
- [`docs/core/START-HERE.md`](docs/core/START-HERE.md)
- [`docs/planning/PROJECT-STATUS.md`](docs/planning/PROJECT-STATUS.md)
- [`docs/planning/PROJECT-VISION.md`](docs/planning/PROJECT-VISION.md)
- [`docs/architecture/README.md`](docs/architecture/README.md)
- [`docs/product/PRD.md`](docs/product/PRD.md)

## Direcao tecnica

- React + Vite no frontend.
- Fastify + TypeScript no backend.
- Worker Node.js persistente.
- PostgreSQL como fonte de verdade.
- SSE para a timeline ao vivo.
- FFmpeg, FFprobe, MediaInfo e stream tools deterministicas.
- Docker Compose em um unico VPS.

Kael e VHS sao referencias de implementacao, nao dependencias de runtime. O
codigo necessario sera copiado de forma controlada para este repositorio durante
o MVP.

## Desenvolvimento local

```bash
npm install
npm install --prefix ui
docker compose up -d postgres
npm run db:migrate
npm run dev:api
```

Em outros terminais:

```bash
npm run dev:worker
npm run ui:dev
```

- UI: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:3210/v1/health`
