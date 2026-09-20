# Arquitetura

## Componentes

| Container | Origem | Papel |
|---|---|---|
| `web` | `ui/` (nginx) | SPA única; proxia `/api/` → `app:3210` |
| `app` | `src/` (Fastify) | Auth Clerk, investigations, coordenação das engines |
| `lens` | `lens/` (API Python) | Inspeção determinística → snapshot canônico |
| `mock` | `mock/` | Clone/serve de streams; capability URLs de playback |

## Estrutura interna do orquestrador

O `src/` segue arquitetura hexagonal. O domínio e os casos de uso não importam
Fastify, Clerk, SQLite ou os contratos HTTP das engines:

```text
adapters/inbound/http (Fastify + Clerk)
              ↓
application/use-cases → application/ports ← adapters/outbound (Lens + SQLite)
              ↓
           domain

infrastructure (configuração e composição do app)
```

- `domain/`: modelos e regras de inspeções, sem dependências de infraestrutura.
- `application/ports/`: contratos da engine de inspeção e do repositório.
- `application/use-cases/`: criar, listar, consultar e arquivar inspeções.
- `adapters/`: implementações HTTP/Clerk de entrada e Lens/SQLite de saída.
- `infrastructure/`: carrega configuração e conecta os adapters ao Fastify.

## Redes

- `public`: `web` ↔ `app`.
- `internal`: `app` ↔ `lens` ↔ `mock`.
- Sem `internal: true`: lens/mock precisam de egress (clonar origens públicas,
  JWKS do Clerk). A segmentação é por associação de rede, não por bloqueio de
  egress.
- Produção: só `web` (nginx) e `app` recebem tráfego. O data plane do mock é
  publicado pelo nginx do `web` sob `/mock` (mesma origem, sem CORS); o mock
  fica na rede interna e o control plane `/api` dele não é exposto. O engine
  emite as capability URLs já com o prefixo (`STREAMMOCK_BASE_PATH=/mock`) e o
  nginx remove o prefixo antes de encaminhar.
- Dev (compose): `web` :8080, `app` :3210; o mock também publica a porta :8081
  para uso direto/standalone. `MOCK_PUBLIC_URL` é a base absoluta das capability
  URLs de playback usada pelo orquestrador ao montar `playback_url`.

## Modelo de autenticação

| Plano | Quem | Mecanismo |
|---|---|---|
| Control plane (humano → app) | Clerk JWT no orquestrador | Bearer header |
| Control plane interno (app → engines) | Service token (`VH_SERVICE_TOKEN`) | Rede interna + token |
| Data plane (player → `web`/nginx → mock) | Capability URLs (slug/token em path, hash em repouso, TTL) | Sem header — players não enviam |

O mock mantém **dashboard próprio com Clerk** para uso standalone de dev/QA
(times que só querem streams de teste sem o harness completo). Quando chamado
pelo orquestrador, recebe contexto de owner via modo interno.

## Contratos (estado atual)

Implementado:

- `GET /health` (app) — liveness.
- `GET /v1/services` (app) — URLs configuradas das engines.
- `POST /v1/inspections` → 202 + `{inspection_id, status, ...}` (proxy Lens).
- `GET /v1/inspections` → histórico do usuário autenticado.
- `GET /v1/inspections/:id` → detail com estágio e progresso de captura.
- `GET /v1/inspections/:id/snapshot` → snapshot canônico, arquivado no VH na
  primeira leitura (ou servido pela Lens enquanto ainda não arquivado).
- `DELETE /v1/inspections/:id` → remove a inspeção do histórico do dono
  (404 se não existe ou não é dele; não afeta a Lens).
- `GET /v1/streams` → streams (clones) do usuário autenticado, via mock.
- `POST /v1/streams` → cria clone/proxy no mock; `202` com o stream.
- `GET /v1/streams/:id` → stream do dono (404 se não existe no mock).
- `DELETE /v1/streams/:id` → remove um clone (mock exige modo clone + dono).
- `POST /v1/streams/:id/preset` → troca o preset de caos ativo.
- `GET/POST /v1/streams/:id/live` → consulta/controla o live mock HLS local.
- `GET /v1/workspace` → slug, armazenamento e TTL do workspace do dono.
- `POST /v1/streams/proxy` → monta a capability URL de proxy on-demand do
  workspace (sem persistir stream; nada é gravado no mock).
- `GET /v1/workspace/requests` → board de consumo (proxy/clone): requests
  recentes com status, bytes, duração, ranges, CMCD, timings de origem e
  intervenções do preset.
- `DELETE /v1/workspace/requests` → limpa a atividade de um stream/source.
- `POST /v1/playback/sessions` → cria sessão de playback correlacionada no mock
  (CMCD session id + ingest do observer); repassa `Origin` da requisição como
  `allowed_origin` (o mock valida o header na ingestão).
- `GET /v1/playback/sessions` → sessões do dono, filtráveis por
  `stream_id`/`source`/`preset`.
- `GET /v1/playback/sessions/:sessionId/timeline` → timeline correlacionada
  (requests + eventos do observer + resumo + findings determinísticos).
- Os streams devolvidos pelo orquestrador trazem `playback_url` absoluta,
  montada a partir de `MOCK_PUBLIC_URL` + path de playback do mock (data plane
  por capability URL; o browser nunca fala com a API interna do mock). O path já
  vem prefixado com `/mock` pelo engine e é servido pelo nginx do `web`.
- Auth client: Clerk v6 com fallback dev-mode quando
  `VITE_CLERK_PUBLISHABLE_KEY` está ausente (nunca em produção).
- Auth API: Clerk JWT (`@clerk/backend` verifyToken) nas rotas
  `/v1/inspections*`, `/v1/streams*`, `/v1/workspace` e `/v1/playback*`; sem
  `CLERK_SECRET_KEY`, rotas abertas em dev-mode.
- Histórico: o orquestrador persiste `inspection_id`, owner (`sub` do Clerk),
  URL com credenciais de query redigidas, status e snapshots obtidos em SQLite.
  A Lens mantém seu TTL próprio;
  snapshots já arquivados continuam disponíveis após ele.
- UI: `/` (home + CTA), `/dashboard/inspect` (form) e
  `/dashboard/inspect/:id` (polling + triagem de saúde/cobertura, comparação com
  snapshot anterior da mesma origem e timeline de representações com segmentos
  clicáveis, observações de bitrate/entrega, DRM DASH, warnings e snapshot JSON).
  `/dashboard/streams` cria/listar/exclui clones, troca preset, controla o live
  mock e gera URLs de proxy on-demand (sem clonar); playback abre a capability
  URL do mock e um painel de atividade mostra o consumo (requests, ranges,
  CMCD, timings, intervenções). O Playback Lab embute um player (hls.js com
  `@streammock/playback-observer` para HLS; shaka-player para DASH/ClearKey,
  ambos com CMCD nativo) e o Playback Inspector portado do mock (resumo,
  findings, lanes de sinais, waterfall, eventos do observer, export JSON no
  client). DASH usa só os eventos core do observer: o subpath `./shaka` não
  existe no pacote publicado (`@streammock/playback-observer@0.1.0`); o bridge
  dedicado fica para quando o pacote o publicar (não duplicamos código da
  engine no VH).

Planejado (Fase 4+):

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
  adicionamos ao `Dockerfile` da lens — sem ele a Lens omite
  `probe` silenciosamente (`_optional_ffprobe`).

## Decisões

Desde analyzer Lens 1.5.1, a view de frames só apresenta DTS com proveniência
`derived (ffprobe packet)`. O adapter Lens verifica stream/posição únicos, PTS e
tamanho antes de copiar o DTS do pacote (lens/docs/adr/0004-frame-packet-timestamps.md).
O VH não recalcula timestamps. Snapshots antigos ficam com DTS indisponível nesta
view e exigem nova inspeção; samples/PES estruturais permanecem independentes.

| ID | Decisão |
|---|---|
| AD-0001 | Reset do repo: novo VH é orquestrador; engines permanecem os repos `streamlens` e `streammock`, integrados por HTTP (tag `legacy-pre-reset`). |
| AD-0002 | Coleta de mídia: baseline determinística curta (janela ~10 s, orçamento por chamada); aprofundamento é explícito, via tools do agente com budget e evidence atribuída (Fase 4). |
| AD-0003 | StreamMock permanece serviço standalone (uso dev/QA) e interno (modo service token para o orquestrador); não é fundido ao VH. |
| AD-0004 | Auth dividida: Clerk no control plane; capability URLs no data plane; service token entre app e engines. |
| AD-0005 | UI roda em dev-mode aberto (sem Clerk) quando não há publishable key, para manter `compose up` verde sem segredos; o banner indica o modo. |
| AD-0006 | Monorepo: `streamlens` e `streammock` movidos para `lens/` e `mock/` via `git subtree` (história preservada), superando AD-0001 e AD-0003. Motivo: o compose já era uma unidade de deploy só (`../streamlens` não existia no CI nem em clone limpo); mudanças na API do lens e no `LensClient` saem no mesmo PR, e um único workflow builda as 4 imagens. |
| AD-0007 | O orquestrador adota arquitetura hexagonal: casos de uso dependem de portas; Fastify/Clerk, Stream Lens e SQLite são adapters substituíveis. |
| AD-0008 | DTS de frames é evidência de pacote produzida pela Lens conforme ADR-0004 dela; VH exige proveniência verificável e não aplica heurísticas nem reescreve snapshots históricos. |
| AD-0009 | Layout Python da Lens simplificado na raiz de `lens/`, conforme ADR-0006 da engine; Compose e CI usam `lens/Dockerfile`. Fronteiras HTTP e contratos permanecem iguais. |
| AD-0010 | Lens separa seleção de formatos em `application/` e parsing puro em `parsers/` (ADR-0007 da engine); ffprobe e persistência continuam adapters. Integração do VH permanece HTTP, sem alteração de contrato. |
| AD-0011 | Lens mantém `CapturePlan` e a orquestração de captura em `application/`; adapters só buscam e persistem bytes via ports, conforme ADR-0008 da engine; contratos HTTP e snapshot permanecem iguais. |
| AD-0012 | StreamMock ganha modo interno: com `STREAMMOCK_SERVICE_TOKEN` configurado, `X-Service-Token` + `X-Owner-Id` identificam o dono injetado pelo orquestrador (comparação em tempo constante), sem exigir JWT do Clerk. O dashboard standalone do mock segue autenticado por Clerk. O orquestrador expõe `/v1/streams*` e `/v1/workspace` com a auth humana e reescreve paths de playback para `MOCK_PUBLIC_URL`; o browser nunca chama a API interna do mock. |
| AD-0013 | CMCD no Playback Lab do VH: o player embutido usa o core + adapter HLS do `@streammock/playback-observer` publicado e CMCD nativo do hls.js/shaka. Como o subpath `./shaka` não existe no pacote publicado, DASH/ClearKey roda com os eventos core do observer (sem eventos do player) e CMCD nativo do shaka; o bridge shaka fica para quando o pacote o publicar — não duplicamos código da engine no VH. O export de sessão é montado no client a partir da timeline do orquestrador (sem rota de export no VH). |
