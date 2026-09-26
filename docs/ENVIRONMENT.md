# Variáveis de ambiente

Referência das variáveis de ambiente **efetivamente lidas pelo código atual** do
Video Harness e pelo `compose.yml`/`compose.prod.yml`.

- Nenhum segredo, `.env` ou valor real entra no Git (raiz `.gitignore` ignora
  `.env` e `.env.*`, exceto `.env.example`).
- Copie `.env.example` para `.env` para desenvolvimento local.
- O `app` carrega o `.env` da raiz via `dotenv` (`src/infrastructure/config.ts`).
- A UI (Vite) lê `ui/.env*` — **não** o `.env` da raiz — em `npm run ui:dev`.

## 1. Compose e host (`.env` da raiz)

Variáveis consumidas pelos arquivos Compose e pelos build args.

| Variável | Padrão | Onde é usada | Descrição |
|---|---|---|---|
| `VH_WEB_PORT` | `8080` | `compose.yml` | Porta do host publicada para o `web`. |
| `VH_APP_PORT` | `3210` | `compose.yml` | Porta do host publicada para o `app`. |
| `VH_MOCK_PORT` | `8081` | `compose.yml` | Porta do host publicada para o playback do `mock` (capability URLs). |
| `VH_MOCK_PUBLIC_URL` | `http://127.0.0.1:8080` | `compose.yml` → `MOCK_PUBLIC_URL` do `app` | Base absoluta das capability URLs de playback no dev. |
| `MOCK_PUBLIC_URL` | — (obrigatória) | `compose.prod.yml` → `app` | Base absoluta das capability URLs em produção (ex.: URL pública do web). |
| `STREAMMOCK_BASE_PATH` | `/mock` | `compose.yml` → `mock` | Prefixo público do data plane emitido pelo mock; o nginx do `web` remove antes de encaminhar. Vazio = falar direto com o mock. |
| `VITE_CLERK_PUBLISHABLE_KEY` | vazio | build args do `web` e do `mock` | Chave pública do Clerk. Ausente ⇒ frontend em dev-mode aberto (banner amarelo). |
| `CLERK_SECRET_KEY` | vazio (dev) | `app` e `mock` | Secret do Clerk. Ausente ⇒ rotas autenticadas abertas em dev-mode. Obrigatória em produção. |
| `VH_SERVICE_TOKEN` | `dev-internal-token` | `app` e `mock` (como `STREAMMOCK_SERVICE_TOKEN`) | Token de serviço interna `app → engines` (header `X-Service-Token`). Obrigatória em produção. |
| `VH_DATABASE_PATH` | `.video-harness-data/history.sqlite` | `app` | Caminho do SQLite de histórico de inspeções e hashes/metadados de tokens MCP. No compose é `/data/history.sqlite` (volume `app-data`). |
| `STREAMMOCK_CLONE_MAX_BYTES` | `1073741824` (1 GiB) | `mock` | Tamanho máximo por clone. |
| `STREAMMOCK_USER_QUOTA_BYTES` | `5368709120` (5 GiB) | `mock` | Cota agregada de clones por dono (`0` desliga). |
| `STREAMMOCK_CLONE_TTL_HOURS` | `0` | `mock` | Expiração de clones; `0` desliga. |

Em `compose.prod.yml`, `MOCK_PUBLIC_URL`, `VH_SERVICE_TOKEN` e `CLERK_SECRET_KEY`
são exigidas com `${VAR:?...}` — o deploy falha se não forem definidas.

## 2. Orquestrador `app` (`src/infrastructure/config.ts`)

Validado com Zod; pode rodar fora do compose (host ou Docker direto).

| Variável | Padrão | Descrição |
|---|---|---|
| `VH_APP_HOST` | `127.0.0.1` | Interface de bind. No Docker: `0.0.0.0`. |
| `VH_APP_PORT` | `3210` | Porta de escuta. |
| `LENS_URL` | `http://lens:8000` | Base da API da Lens (rede interna). |
| `MOCK_URL` | `http://mock:8080` | Base da API interna do mock (rede interna). |
| `MOCK_PUBLIC_URL` | `http://127.0.0.1:8081` | Base absoluta das capability URLs de playback montadas para o browser. |
| `VH_SERVICE_TOKEN` | `dev-internal-token` | Token enviado às engines no control plane interno. |
| `VH_DATABASE_PATH` | `.video-harness-data/history.sqlite` | SQLite de histórico/ownership e hashes/metadados de tokens MCP. |
| `CLERK_SECRET_KEY` | ausente | Verificação de JWT (`@clerk/backend`). Ausente ⇒ rotas abertas em dev-mode. |

## 3. UI `web` (`ui/`)

O MCP não exige variável de segredo compartilhado: cada usuário gera seu token
na página `/dashboard/mcp`. `/mcp` sempre exige esse Bearer, mesmo sem
`CLERK_SECRET_KEY`. A ausência da chave Clerk mantém somente as rotas de
gerenciamento no fallback `dev-user`; não usar esse modo em produção.

| Variável | Padrão | Descrição |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | ausente | Chave pública do Clerk, embutida no bundle em build-time. Ausente ⇒ `DevAuthProvider` (autenticação desativada). |

Notas:

- No Docker, entra como build arg (`ui/Dockerfile`, `compose.yml`, workflow de
  imagens).
- Em `npm run ui:dev`, o Vite lê `ui/.env*` (ex.: `ui/.env.local`); a porta do
  dev server (`5173`) e o proxy `/api` → `http://127.0.0.1:3210` são fixos em
  `ui/vite.config.ts` (sem variável).

## 4. Engines configuradas pelo VH

Estas são passadas pelo `compose.yml`/`compose.prod.yml`. O conjunto completo de
variáveis de cada engine (e seus defaults próprios) fica nos AGENTS/README de
`lens/` e `mock/`.

### Lens (`lens/`)

| Variável | Valor no compose | Descrição |
|---|---|---|
| `STREAM_LENS_TTL_SECONDS` | `3600` | TTL das inspeções no repositório da Lens. |
| `STREAM_LENS_MAX_CONCURRENCY` | `4` | Concorrência máxima do job queue in-process. |

Outras aceitas pela engine (não definidas pelo compose):

| Variável | Default | Descrição |
|---|---:|---|
| `STREAM_LENS_WORKSPACE` | `.runtime/inspections` | Diretório de inspeções. |
| `STREAM_LENS_FIXTURES` | `fixtures/` | Diretório de fixtures locais. |
| `STREAM_LENS_PURGE_INTERVAL_SECONDS` | `60` | Intervalo de limpeza por TTL. |
| `STREAM_LENS_WINDOW_SECONDS` | `10` | Janela de captura; a inspeção padrão seleciona pelo menos 2 segmentos por representação que tenha 2 ou mais capturáveis. Teto de 60 s. |
| `STREAM_LENS_MAX_TOTAL_BYTES` | `500000000` | Orçamento base; a Lens reserva bytes para a cobertura mínima e pode elevar o teto efetivo. Um valor configurado abaixo de 500 MB é um teto explícito. |
| `STREAM_LENS_MAX_SEGMENT_BYTES` | `20000000` | Cap por resposta de segmento. |
| `STREAM_LENS_MAX_PLAYLISTS` | `0` | Teto opcional de playlists HLS; `0` segue todas as declaradas. |
| `STREAM_LENS_ALLOW_LOOPBACK` | desabilitado | Permite loopback apenas em dev/testes locais. |

### Mock (`mock/`)

| Variável | Valor no compose | Descrição |
|---|---|---|
| `STREAMMOCK_BASE_PATH` | `/mock` | Prefixo público do data plane (playback/ingest/license/recursos). |
| `CLERK_SECRET_KEY` | `${CLERK_SECRET_KEY}` | Verificação de JWT do dashboard standalone do mock. |
| `STREAMMOCK_SERVICE_TOKEN` | `${VH_SERVICE_TOKEN}` | Habilita o modo interno (`X-Service-Token` + `X-Owner-Id`). |
| `STREAMMOCK_CLONE_MAX_BYTES` | `1073741824` | Tamanho máximo por clone. |
| `STREAMMOCK_USER_QUOTA_BYTES` | `5368709120` | Cota agregada por dono. |
| `STREAMMOCK_CLONE_TTL_HOURS` | `0` | Expiração de clones. |

Outras aceitas pela engine (não definidas pelo VH): `STREAMMOCK_ADDR`,
`STREAMMOCK_DB`, `STREAMMOCK_STORAGE`, `STREAMMOCK_CLONE_JANITOR_MINUTES`,
`STREAMMOCK_PACKAGER_BIN`, `STREAMMOCK_PACKAGER_TIMEOUT_MINUTES`,
`STREAMMOCK_BBB_URL`, `STREAMMOCK_RATELIMIT_RPM`, `STREAMMOCK_RATELIMIT_BURST`,
`STREAMMOCK_LICENSE_RATELIMIT_RPM`, `STREAMMOCK_LICENSE_RATELIMIT_BURST`,
`STREAMMOCK_EPHEMERAL_TTL_MINUTES`, `STREAMMOCK_ALLOW_PRIVATE_TARGETS`,
`STREAMMOCK_PORT` (standalone em `mock/compose.yaml`).

## 5. Dev sem Docker

Com as engines no host, o orquestrador precisa de:

```bash
LENS_URL=http://127.0.0.1:8000
MOCK_URL=http://127.0.0.1:8080
MOCK_PUBLIC_URL=http://127.0.0.1:8080
STREAMMOCK_SERVICE_TOKEN=$VH_SERVICE_TOKEN   # no mock
```
