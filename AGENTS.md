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
   Follow-up da view: matriz ABR e bitstream/A/V (aparecem no JSON bruto).
   **Dependência**: barras de frame, GOP e sincronismo A/V exigem ffprobe na
   imagem da lens — adicionado ao `backend/Dockerfile` da lens (fato dela,
   não do VH); sem ffprobe a Lens degrada silenciosamente (`_optional_ffprobe`).
4. **Fase 3 — Streams**: orquestrador proxifica as workspace APIs do mock
   injetando ownership; mock mantém dashboard próprio (uso standalone de
   dev/QA) e ganha modo interno (service token).
5. **Fase 4 — Investigations agênticas**: do zero. Baseline = snapshot da Lens
   (janela curta, default 10 s); agente aprofunda com tools estruturadas
   (`fetch_window`, `probe`, `decode_test`) com budget por chamada e teto por
   investigation; toda coleta extra vira evidence atribuída.
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
- Nenhum documento pode alegar capacidade que o código não implementa.
