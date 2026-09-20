# Video Harness

Camada de orquestração e produto para investigação de video streaming. O VH
coordena duas engines independentes e entrega a experiência única (UI, auth,
investigações, relatórios):

- **Stream Lens** (`lens/`) — inspeção determinística de HLS/DASH com
  snapshot canônico versionado.
- **Stream Mock** (`mock/`) — clone, mock e serve de streams (HLS/DASH,
  ClearKey, live), com capability URLs para players.

```text
[Browser] → Frontend ──► Orchestrator API (este repo)
                             │            │
                       Stream Lens    Stream Mock
                       (Python, :8000) (Go, :8080)

[Device/Player] ──► capability URLs do Mock (sem header de auth)
```

## Stack

| Container | Papel | Tech |
|---|---|---|
| `web` | Frontend único (home, dashboard, inspect, streams) | React + Vite, servido por nginx |
| `app` | Orquestrador: Clerk, investigations, coordenação | Node 22 + Fastify + TypeScript |
| `lens` | Engine de inspeção | Python + FastAPI |
| `mock` | Engine de clone/serve | Go |

## Quickstart

```bash
cp .env.example .env      # ajuste as chaves do Clerk quando chegar na Fase 1
make dc-up                # sobe web, app, lens e mock (usa os repos irmãos)
```

| Serviço | URL local |
|---|---|
| UI | http://127.0.0.1:8080 |
| Orquestrador | http://127.0.0.1:3210 |
| Mock (playback/capability URLs) | http://127.0.0.1:8081 |

Dev sem Docker:

```bash
npm install && npm install --prefix ui
npm run dev      # orquestrador
npm run ui:dev   # UI com HMR
```

## Roadmap

1. ~~Fase 0 — Fundação (reset, compose, orquestrador mínimo)~~ ✅
2. ~~Fase 1 — Home + login Clerk + shell do dashboard~~ ✅ (sem chave do Clerk,
   a UI cai em dev-mode aberto com banner; com `VITE_CLERK_PUBLISHABLE_KEY`
   configurada em `ui/.env.local`, o fluxo de sign-in/modal liga)
3. ~~Fase 2 — Inspect (orquestrador → Lens)~~ ✅ (rotas `/api/v1/inspections*`
   com auth Clerk, histórico próprio por usuário e snapshots terminais arquivados
   ao serem obtidos;
   UI: formulário, progresso por estágio e snapshot JSON;
   validado E2E contra a Lens com stream público)
4. ~~Fase 3 — Streams (orquestrador → Mock; mock mantém uso standalone)~~ ✅
   (mock ganhou modo interno por service token; orquestrador proxia as workspace
   APIs com ownership e injeta o `sub` do Clerk; UI de Streams: criar/listar/
   excluir clones, trocar preset, controlar o live mock HLS, gerar URLs de
   proxy on-demand sem clonar e acompanhar o consumo no painel de atividade
   (requests, ranges, CMCD, timings, intervenções), com playback em capability
   URLs do mock; Playback Lab com player embutido (CMCD + observer) e
   Playback Inspector de sessões correlacionadas)
5. Fase 4 — Investigations agênticas (baseline curta + aprofundamento por tools)
6. Fase 5 — Experiments (clone + network shaping + replay em device)

## Histórico

O código anterior do VH (pipeline próprio de coleta, stream-tools, record) foi
substituído por esta arquitetura. Referência: `git tag legacy-pre-reset`.
