# AGENTS.md — Video Harness

Instruções obrigatórias para qualquer agente que atuar neste repositório.

## Missão

O Video Harness é a camada de **orquestração e produto** do ecossistema de
investigação de video streaming. Ele não é uma engine: coordena dois serviços
independentes e entrega a experiência (UI, auth, investigações, relatórios).

```text
[Browser] → Frontend (React+Vite+Clerk)          ← única entrada pública
                ↓
        Orchestrator API (este repo, TS)         ← Clerk JWT aqui
             ↓                    ↓
       StreamLens (Python)    StreamMock (Go)   ← engines, NUNCA modificadas
                                                 a partir daqui sem ADR

[Device/Player] → capability URLs do StreamMock (direto, sem header de auth)
```

## Serviços do ecossistema

| Serviço | Código | Papel | Acesso |
|---|---|---|---|
| **web** (este repo, `ui/`) | — | Frontend único (home, dashboard, inspect, streams) | público |
| **app** (este repo, `src/`) | — | Orquestrador: auth Clerk, investigations, coordenação | público (API) |
| **lens** | `lens/` | Inspeção/evidência determinística (snapshot canônico) | rede interna |
| **mock** | `mock/` | Clone/serve/mocks de streams, capability URLs | interno + playback exposto |

**Regra fundamental:** Lens e Mock são engines prontas e testadas. Não copiar
código delas, não forkar, não "melhorar" de dentro do VH. Vivem neste repo via
`git subtree` (`lens/`, `mock/`; supera AD-0001/AD-0003 — ver AD-0006), mas
mudanças nelas seguem os processos próprios de cada engine (AGENTS/ADR em
`lens/` e `mock/`), nunca os do VH; a fronteira orquestrador ↔ engines segue
sendo contratos HTTP.

## Fases (não avançar sem concluir a anterior)

1. **Fase 0 — Fundação** ✅: reset do repo, compose com 4 serviços, orquestrador
   mínimo com `/health`, UI shell.
2. **Fase 1 — Home + Login** ✅: rotas `/` (home pública com CTA) e `/dashboard`
   (protegida, shell com sidebar); Clerk `@clerk/react` v6 copiado do mock
   (`Show`/`SignInButton`/`UserButton`); **fallback dev-mode** sem publishable
   key (banner amarelo) para não quebrar dev/local sem segredos.
3. **Fase 2 — Inspect** ✅: `LensClient` (fetch tipado com Zod) +
   rotas `POST/GET /v1/inspections[/:id][/snapshot]` com auth Clerk
   (`@clerk/backend` verifyToken; dev-mode aberto sem secret — mesmo padrão
   AD-0005); token de sessão anexado pelo client via `AuthTokenBridge`. UI:
   formulário de URL, polling por estágio, cards de resumo e **views ricas
   portadas da Lens** (`TimelineView`: track groups, codecs decodificados,
   barra de bitrate, segmentos clicáveis com drill-down e entrega HTTP;
   `DrmOverview`; observações de bitrate; warnings; snapshot JSON bruto).
   O orquestrador mantém histórico por usuário em SQLite (ownership pelo `sub`
   do Clerk; `dev-user` no fallback), arquivando snapshots terminais quando o
   resultado é consultado, além do TTL da Lens.
   Follow-up da view: matriz ABR e bitstream/A/V (aparecem no JSON bruto).
   **Dependência**: barras de frame, GOP e sincronismo A/V exigem ffprobe na
   imagem da lens — adicionado ao `Dockerfile` da lens (fato dela,
   não do VH); sem ffprobe a Lens degrada silenciosamente (`_optional_ffprobe`).
4. **Fase 3 — Streams** ✅: orquestrador proxifica as workspace APIs do mock
   (`/v1/streams*`, `/v1/workspace`) injetando ownership (`sub` do Clerk via
   `X-Owner-Id`) e monta `playback_url` absoluta com `MOCK_PUBLIC_URL`; o mock
   mantém dashboard próprio (uso standalone de dev/QA) e ganhou modo interno por
   service token (`STREAMMOCK_SERVICE_TOKEN` + `X-Service-Token`, comparação em
   tempo constante, desligado se não configurado). UI `/dashboard/streams`:
   criar/listar/excluir clones, trocar preset, controlar o live mock HLS,
   gerar URLs de proxy on-demand (sem clonar) e acompanhar o consumo no painel
   de atividade (requests, ranges, CMCD, timings e intervenções). Playback Lab
   embute player com CMCD + observer (hls.js para HLS; shaka para DASH/ClearKey
   só com eventos core do observer — subpath `./shaka` ausente do pacote
   publicado) e o Playback Inspector portado do mock, correlacionados por
   sessão (`/v1/playback/sessions*`).
   Integração MCP: `/dashboard/mcp` gerencia tokens pessoais (hash em SQLite,
   validade e revogação); `/mcp` no app, publicado como `/api/mcp`, expõe as
   tools de inspeção e investigação via Streamable HTTP. Exige Bearer MCP mesmo
   em dev. Capturas adicionais usam seleção explícita, orçamento e evidência
   vinculada ao baseline, sem reescrever seu snapshot.
5. **Fase 4 — Investigations agênticas**: em andamento. Baseline = snapshot da
   Lens (janela curta, default 10 s); agente consulta cobertura/timeline e pode
   pedir segmentos por referência ou janela, com reserva idempotente de bytes e
   evidência atribuída. `probe`, `decode_test`, budgets de tempo/concurrency mais
   amplos e execução autônoma de LLM continuam pendentes.
6. **Fase 5 — Experiments**: clone do mock + network shaper no orquestrador;
   data plane serve somente recurso registrado.

## Regras de arquitetura

1. Auth humana (Clerk) vive no orquestrador; Lens/Mock não expostos
   diretamente (rede `internal` do compose).
2. Data plane de mídia é do mock: capability URLs (slug/token em path, hasheados
   em repouso), players não enviam headers. Nunca mover para o app.
3. `exactOptionalPropertyTypes` e `noUncheckedIndexedAccess` ligados: campos
   opcionais usam `...(condicao ? { campo: valor } : {})`; acesso por índice
   exige guard.
4. TypeScript `module: NodeNext`: imports relativos com extensão `.js`.
5. Validar entradas/respostas externas com Zod nas fronteiras.
6. Nenhum código de investigação/LLM no orquestrador antes da Fase 4; quando
   existir, ferramentas determinísticas produzem os fatos, o LLM explica.
7. Segurança (SSRF, limites, redaction) é comportamento funcional, nunca etapa
   final. Toda URL de usuário passa pelas engines, que já têm proteção.
8. Sem segredos, `.env` ou dados locais no Git.

## Compose e redes

- `public`: web ↔ app.
- `internal`: app ↔ lens ↔ mock. Sem `internal: true` (engines precisam de
  egress: clonar origens, JWKS do Clerk).
- Só `web` (via nginx) e `app` recebem tráfego do host; mock publica apenas a
  porta de playback (capability URLs).

## Desenvolvimento local

```bash
npm install && npm install --prefix ui
npm run dev        # orquestrador em http://127.0.0.1:3210
npm run ui:dev     # UI em http://127.0.0.1:5173 (proxia /api -> 3210)
make dc-up         # stack completa (lens/mock sobem de ./lens e ./mock)
```

Dev sem Docker exige as engines no host: `MOCK_URL=http://127.0.0.1:8080`,
`MOCK_PUBLIC_URL=http://127.0.0.1:8080`, `LENS_URL=http://127.0.0.1:8000` e
`STREAMMOCK_SERVICE_TOKEN` igual a `VH_SERVICE_TOKEN` no mock.

## Validação mínima

```bash
npm run check
npm test
npm --prefix ui run check
npm --prefix ui run build
git diff --check
```

Registrar no status o que não foi executado e por quê.

## Documentação

- Alterou arquitetura/rede/contratos → atualizar `docs/ARCHITECTURE.md` e a
  tabela de decisões.
- Alterou fase/escopo → atualizar a lista de fases deste arquivo.
- **Criou, renomeou, removeu ou alterou o comportamento/default de qualquer
  variável de ambiente** (no código, `.env.example`, `compose.yml`,
  `compose.prod.yml` ou build args) → atualizar `docs/ENVIRONMENT.md` no mesmo
  conjunto de mudanças, incluindo a variável na seção correta e refletindo o
  novo default. Se a variável for de uma engine (`lens/`/`mock/`), registrar
  também a mudança nos docs da engine conforme o processo dela.
- Nenhum documento pode alegar capacidade que o código não implementa.
