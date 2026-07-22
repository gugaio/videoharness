# Project Status - Video Harness Space

Ultima atualizacao: **2026-07-21**

## Resumo

- Fase ativa: **Fase 2 - Evidencia Deterministica**.
- Estado: **pronta para iniciar**.
- Repositorio: novo e independente.
- Runtime: API, worker, UI e PostgreSQL executaveis.
- Objetivo imediato: definir evidence bundle e acesso seguro a streams.

## Fases

| Fase | Status | Objetivo |
|---|---|---|
| 0 | Concluida | Fundacao documental, decisoes e plano executavel |
| 1 | Concluida | Thin slice completo com API, worker, Postgres, SSE e UI |
| 2 | Pronta para iniciar | Evidencia deterministica real de streaming |
| 3 | Planejada | Investigacao assistida por IA e report estruturado |
| 4 | Planejada | UX premium e experiencia end-to-end |
| 5 | Planejada | Hardening, deploy e validacao com usuarios |

## Entregue

- Definicao do foco do MVP.
- Decisao por repositorio novo e autonomo.
- Decisao de copiar codigo necessario de Kael e VHS sem dependencia de runtime.
- Stack baseada no Kael: React, Vite, Fastify, TypeScript, Zod e Vitest.
- Arquitetura hexagonal leve como regra de dependencia.
- Bootstrap documental do repositorio.
- Backend TypeScript strict com Fastify 5.
- Worker Node.js com conexao e lifecycle inicial.
- PostgreSQL 17 e migration das cinco entidades do MVP.
- Health endpoint com verificacao real do banco.
- Criacao transacional e idempotente de investigation, job e evento inicial.
- Consulta persistida e timeline SSE com replay por `Last-Event-ID`.
- Homepage conectada e primeira pagina real do caso.
- Homepage React/Vite dark-first e responsiva.
- Dockerfiles, Compose e CI inicial.
- Worker PostgreSQL com claim concorrente seguro, lease, heartbeat e retry limitado.
- State machine persistida de `queued` ate `completed` ou `failed`.
- Recuperacao de jobs abandonados e encerramento de tentativas esgotadas.
- Report fixture persistido, consultavel e apresentado na tela do caso.

## Checklist da Fase 1

- [x] Definir contratos iniciais de investigation e intake.
- [x] Implementar repository PostgreSQL de intake.
- [x] Criar investigation, job e evento inicial em uma transacao.
- [x] Implementar claim, lease e heartbeat no worker.
- [x] Implementar historico e stream SSE.
- [x] Conectar o formulario da homepage ao fluxo real.
- [x] Exibir timeline persistida.
- [x] Exibir report placeholder.

## Pendencias da fase ativa

- [ ] Definir schema versionado do evidence bundle.
- [ ] Criar port deterministico de coleta.
- [ ] Proteger acesso de rede contra SSRF e redirects maliciosos.
- [ ] Detectar HLS/DASH com timeout e limites.
- [ ] Persistir o primeiro manifest como artifact.

## Proximo passo recomendado

Definir o evidence bundle versionado e implementar a primeira fronteira segura de
acesso a manifests HLS/DASH, com protecao SSRF, timeout e limites.

## Registro de atualizacoes

### 2026-07-21 - Worker recuperavel e conclusao da Fase 1

Fase impactada: 1.

Entrega:

- Criados port e adapter PostgreSQL especificos para execucao de jobs.
- O job reclamado separa metadados de execucao do contexto tipado da investigation,
  evitando repetir `sourceUrl` e `problemDescription` no contrato do job.
- Claim usa `FOR UPDATE SKIP LOCKED`, incrementa tentativa e assume jobs pendentes
  ou com lease expirado.
- Heartbeat renova ownership durante etapas longas e transicoes renovam o lease.
- Lifecycle avanca por `validating`, `collecting`, `analyzing` e `synthesizing`,
  sempre persistindo estado e evento na mesma transacao.
- Falhas voltam o caso para fila enquanto houver tentativas; esgotamento encerra
  job e investigation como `failed`.
- Conclusao grava report, investigation, job e evento atomicamente.
- Implementado `GET /v1/investigations/:id/report` e exibicao do report na UI.
- Report e eventos da Fase 1 se identificam como fixtures e nao alegam analise de
  streaming inexistente.

Arquivos-chave:

- `src/investigation/application/run-investigation.ts`
- `src/investigation/ports/investigation-job.ts`
- `src/investigation/adapters/postgres-investigation-job.ts`
- `src/worker/index.ts`
- `src/investigation/domain/investigation-report.ts`
- `ui/src/pages/InvestigationPage.tsx`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 15 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] fluxo real concluiu com 1 job, 6 eventos e 1 report persistido;
- [x] report fixture consultado pela API real;
- [x] job com lease expirado foi recuperado por outro worker na tentativa 2;
- [x] API e workers encerraram graciosamente por sinal.

Pendencias:

- O pipeline ainda nao acessa nem analisa streams.
- O report ainda e uma fixture tecnica, conforme o escopo da Fase 1.

Proximo passo recomendado:

- Iniciar a Fase 2 pelo evidence bundle e pela protecao SSRF.

### 2026-07-21 - Consulta, SSE e primeira tela de investigacao

Fase impactada: 1.

Entrega:

- Criado query port e adapter PostgreSQL para casos e eventos.
- Implementados `GET /v1/investigations/:id` e SSE append-only em
  `GET /v1/investigations/:id/events`.
- SSE restaura historico, usa IDs persistidos, respeita `Last-Event-ID`, envia
  keepalive e reconecta sem duplicar eventos na UI.
- Homepage passou a criar investigacoes reais e navegar imediatamente para o caso.
- Criada primeira tela de investigacao com estado, relato, conexao e timeline viva.

Arquivos-chave:

- `src/investigation/adapters/postgres-investigation-query.ts`
- `src/investigation/application/investigation-queries.ts`
- `src/api/routes/investigations.ts`
- `ui/src/pages/HomePage.tsx`
- `ui/src/pages/InvestigationPage.tsx`
- `ui/src/lib/api.ts`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 10 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] GET do caso validado via proxy Vite;
- [x] SSE restaurou evento persistido real;
- [x] `Last-Event-ID: 1` nao reenviou o evento 1;
- [x] criacao via proxy navegavel validada contra PostgreSQL real.

Pendencias:

- O worker ainda nao avanca o caso alem de `queued`.
- O report placeholder ainda nao existe.

Proximo passo recomendado:

- Implementar lifecycle recuperavel do worker.

### 2026-07-21 - Fundacao executavel do produto

Fases impactadas: 0 e 1.

Entrega:

- Criados backend Fastify 5, worker Node.js e contratos iniciais.
- Adicionados PostgreSQL 17, migration SQL, Dockerfiles e Docker Compose.
- Implementado `GET /v1/health` com status real do banco e testes de sucesso/falha.
- Criada homepage React/Vite/Tailwind na direcao dark-first do PRD.
- Adicionado CI para check, testes e builds de backend e UI.
- Dependencias de producao e desenvolvimento ficaram sem vulnerabilidades conhecidas
  pelo `npm audit` atual.
- Implementado `POST /v1/investigations` com Zod, `Idempotency-Key`, transacao
  atomica e replay seguro.

Arquivos-chave:

- `src/api/server.ts`
- `src/worker/index.ts`
- `src/database/migrations/001_initial.sql`
- `src/database/migrations/002_investigation_idempotency.sql`
- `src/investigation/application/start-investigation.ts`
- `src/investigation/adapters/postgres-investigation-intake.ts`
- `ui/src/App.tsx`
- `compose.yml`
- `.github/workflows/ci.yml`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 7 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `npm audit` na raiz e em `ui/`;
- [x] migration aplicada em PostgreSQL 17 real;
- [x] smoke de API, worker, UI e proxy `/v1`.
- [x] build e smoke integrado das imagens Docker de API, worker e web.
- [x] smoke real de criacao, replay idempotente e conflito `409`;
- [x] verificado no PostgreSQL: uma request criou exatamente 1 investigation, 1
  job e 1 evento.

Pendencias:

- O worker apenas verifica disponibilidade do banco; ainda nao reclama jobs.
- O CTA permanece desabilitado ate existirem pagina do caso e timeline consultavel.

Proximo passo recomendado:

- Implementar consulta do caso, historico de eventos e SSE.

### 2026-07-21 - Fundacao documental inicial

Fase impactada: 0.

Entrega:

- Criado o bootstrap obrigatorio para agentes.
- Registrados PRD, visao, arquitetura, decisoes, fases, guia de UI e API planejada.
- Formalizados stack, escopo e estrategia de copia controlada de Kael/VHS.

Arquivos-chave:

- `AGENTS.md`
- `docs/core/START-HERE.md`
- `docs/product/PRD.md`
- `docs/planning/PROJECT-VISION.md`
- `docs/architecture/README.md`

Checklist de validacao:

- [x] arquivos e links internos principais verificados;
- [x] whitespace e code fences verificados;
- [ ] primeiro commit criado pelo responsavel.

Pendencias:

- O projeto ainda nao possui runtime nem scripts de validacao.

Proximo passo recomendado:

- Iniciar o thin slice da Fase 1.

## Template para proximas atualizacoes

```md
### YYYY-MM-DD - titulo curto

Fase impactada: N.

Entrega:
- item

Arquivos-chave:
- `arquivo`

Checklist de validacao:
- [x] comando

Pendencias:
- item

Proximo passo recomendado:
- item
```
