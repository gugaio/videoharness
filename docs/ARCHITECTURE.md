# Arquitetura

## Componentes

| Container | Origem | Papel |
|---|---|---|
| `web` | `ui/` (nginx) | SPA única; proxia `/api/` → `app:3210` |
| `app` | `src/` (Fastify) | Auth Clerk, investigations, coordenação das engines |
| `lens` | `../streamlens` (backend) | Inspeção determinística → snapshot canônico |
| `mock` | `../streammock` | Clone/serve de streams; capability URLs de playback |

## Redes

- `public`: `web` ↔ `app`.
- `internal`: `app` ↔ `lens` ↔ `mock`.
- Sem `internal: true`: lens/mock precisam de egress (clonar origens públicas,
  JWKS do Clerk). A segmentação é por associação de rede, não por bloqueio de
  egress.
- Publicado no host (dev): `web` :8080, `app` :3210, `mock` :8081 (playback).
  Lens **nunca** é publicada.

## Modelo de autenticação

| Plano | Quem | Mecanismo |
|---|---|---|
| Control plane (humano → app) | Clerk JWT no orquestrador | Bearer header |
| Control plane interno (app → engines) | Service token (`VH_SERVICE_TOKEN`) | Rede interna + token |
| Data plane (player → mock) | Capability URLs (slug/token em path, hash em repouso, TTL) | Sem header — players não enviam |

O mock mantém **dashboard próprio com Clerk** para uso standalone de dev/QA
(times que só querem streams de teste sem o harness completo). Quando chamado
pelo orquestrador, recebe contexto de owner via modo interno.

## Contratos (estado atual)

Implementado:

- `GET /health` (app) — liveness.
- `GET /v1/services` (app) — URLs configuradas das engines.
- `POST /v1/inspections` → 202 + `{inspection_id, status, ...}` (proxy Lens).
- `GET /v1/inspections/:id` → detail com estágio e progresso de captura.
- `GET /v1/inspections/:id/snapshot` → snapshot canônico cru (passthrough).
- Auth client: Clerk v6 com fallback dev-mode quando
  `VITE_CLERK_PUBLISHABLE_KEY` está ausente (nunca em produção).
- Auth API: Clerk JWT (`@clerk/backend` verifyToken) nas rotas
  `/v1/inspections*`; sem `CLERK_SECRET_KEY`, rotas abertas em dev-mode.
- UI: `/` (home + CTA), `/dashboard/inspect` (form) e
  `/dashboard/inspect/:id` (polling + resumo + timeline de representações
  com segmentos clicáveis, observações de bitrate/entrega, DRM DASH,
  warnings e snapshot JSON).

Planejado (Fase 3+):

- `POST /api/streams/...` → proxy das workspace APIs do mock com ownership.
- SSE `GET /api/events/...` → timeline de investigações (Fase 4).

## Limitações conhecidas

- **Restart da lens perde inspeções em voo** (`job_lost`): o queue de jobs
  da Lens é in-process (decisão dela, ADR-0003) — recriar o container com
  inspeções rodando falha as inspeções afetadas. Não reiniciar a lens
  durante uso; para deploy sem perda, a Lens precisará de queue externa
  (não é escopo do VH).

- A Lens tem timeout de **conexão de 5 s fixo** (`safe_http_fetcher.py`,
  sem env) — em redes lentas (VPN) o fetch do manifesto pode falhar com
  `timeout ao obter manifesto`; retry resolve. Ajuste ideal é tornar isso
  configurável no repo da Lens (com o ADR dela).
- Timeline/DRM/containers do snapshot foram portadas da Lens como views
  React (`components/TimelineView.tsx`, `components/DrmOverview.tsx`,
  `components/ContainersView.tsx`, `codec.ts`); a matriz ABR e
  bitstream/A/V permanecem como follow-up (hoje aparecem no JSON bruto).
- A camada derivada de containers (frames I/P/B, GOP, sincronismo A/V,
  boxes fMP4, PIDs TS) depende de **ffprobe instalado na imagem da lens**;
  adicionamos ao `backend/Dockerfile` da lens — sem ele a Lens omite
  `probe` silenciosamente (`_optional_ffprobe`).

## Decisões

| ID | Decisão |
|---|---|
| AD-0001 | Reset do repo: novo VH é orquestrador; engines permanecem os repos `streamlens` e `streammock`, integrados por HTTP (tag `legacy-pre-reset`). |
| AD-0002 | Coleta de mídia: baseline determinística curta (janela ~10 s, orçamento por chamada); aprofundamento é explícito, via tools do agente com budget e evidence atribuída (Fase 4). |
| AD-0003 | StreamMock permanece serviço standalone (uso dev/QA) e interno (modo service token para o orquestrador); não é fundido ao VH. |
| AD-0004 | Auth dividida: Clerk no control plane; capability URLs no data plane; service token entre app e engines. |
| AD-0005 | UI roda em dev-mode aberto (sem Clerk) quando não há publishable key, para manter `compose up` verde sem segredos; o banner indica o modo. |
