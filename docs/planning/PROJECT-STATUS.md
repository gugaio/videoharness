# Project Status - Video Harness Space

Ultima atualizacao: **2026-07-22**

## Resumo

- Fase ativa: **Fase 2 - Evidencia Deterministica**.
- Estado: **em andamento**.
- Repositorio: novo e independente.
- Runtime: API, worker, UI e PostgreSQL executaveis.
- Objetivo imediato: validar a amostra HLS em streams reais e aprofundar DASH.

## Fases

| Fase | Status | Objetivo |
|---|---|---|
| 0 | Concluida | Fundacao documental, decisoes e plano executavel |
| 1 | Concluida | Thin slice completo com API, worker, Postgres, SSE e UI |
| 2 | Em andamento | Evidencia deterministica real de streaming |
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
- Cliente HTTP com protecao SSRF, IP fixado, redirects revalidados, timeout e
  limite de bytes.
- Deteccao inicial HLS/DASH e evidence bundle versionado.
- Root manifest persistido como artifact e report deterministico apresentado na UI.
- Artifacts registrados atomicamente em lote com `logicalKey` idempotente por
  investigation e limpeza segura entre retries.
- Evidence Bundle v2 preparado para multiplos manifests e media samples, mantendo
  leitura dos reports v1 existentes.
- Parser HLS profundo com variants, renditions e estrutura de media playlist.
- Coleta limitada de uma variant e uma rendition de audio, com revalidacao SSRF em
  cada URI derivada e persistencia atomica dos manifests relacionados.
- Amostragem protegida de um media segment por playlist HLS selecionada, com init
  segment CMAF quando aplicavel, limite por resposta e limite agregado.
- FFprobe local com timeout, argumentos estruturados, output limitado e limpeza
  de workspace; codecs, tracks, duracao e timestamps entram no evidence bundle.

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

- [x] Definir schema versionado do evidence bundle.
- [x] Criar port deterministico de coleta.
- [x] Proteger acesso de rede contra SSRF e redirects maliciosos.
- [x] Detectar HLS/DASH com timeout e limites.
- [x] Persistir o primeiro manifest como artifact.
- [x] Extrair estrutura profunda de variants/renditions HLS.
- [x] Coletar manifests HLS derivados com amostragem limitada.
- [ ] Extrair representations DASH.
- [x] Coletar e analisar uma amostra limitada de segmentos HLS.

## Proximo passo recomendado

Validar a coleta HLS em streams reais MPEG-TS/CMAF e, depois, extrair
representations DASH com o mesmo limite e modelo de evidencia.

## Registro de atualizacoes

### 2026-07-22 - Amostra HLS e FFprobe estruturado

Fase impactada: 2.

Entrega:

- Media playlists agora descrevem segmentos, sequencias, duracoes, discontinuity,
  `EXT-X-MAP`, byte ranges e criptografia declarada.
- Worker coleta no maximo um segmento por variant/rendition selecionada e seu init
  segment, pela mesma fronteira SSRF usada para manifests.
- A amostra possui limite de 8 MiB por resposta e 16 MiB agregado por padrao.
- FFprobe processa somente arquivo temporario local, com timeout e output limitado;
  container, tracks, codecs e timestamps sao persistidos no Evidence Bundle v2.
- Artifacts de manifests e media samples entram no mesmo lote idempotente. A UI
  passou a identificar o report como evidencia deterministica.
- Criptografia e byte ranges sao limitations explicitas nesta fatia, sem buscar
  chaves nem executar decriptacao.

Arquivos-chave:

- `src/investigation/adapters/http-media-sample-collector.ts`
- `src/investigation/adapters/ffprobe-media-probe.ts`
- `src/investigation/application/run-investigation.ts`
- `src/stream-tools/hls-manifest.ts`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 62 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`.

Pendencias:

- Ainda falta smoke contra stream HLS publico e fixtures reais para atraso A/V.
- DASH continua com deteccao superficial.

Proximo passo recomendado:

- Executar smoke MPEG-TS/CMAF e iniciar parsing de representations DASH.

### 2026-07-22 - Parsing profundo e manifests derivados HLS

Fase impactada: 2.

Entrega:

- Importada e adaptada a parte pura do parser HLS do VHS, com origem registrada no
  README do modulo e sem dependencia de runtime.
- Masters agora extraem variants, renditions, codecs declarados, grupos, bandwidth,
  resolution, frame rate e URLs resolvidas.
- Media playlists extraem segment count, target/media/discontinuity sequences,
  discontinuity count e `ENDLIST` sem baixar chunks.
- Amostragem seleciona maior bandwidth com desempate estavel; audio vinculado
  prefere `DEFAULT`, `AUTOSELECT` e ordem da master.
- Root, variant e audio sao buscados pelo `SafeHttpClient`; os mesmos objetos
  `Manifest` recebem suas referencias de artifact antes do lote idempotente.
- Evidence Bundle e report registram topologia, escolha, artifacts e limitacoes.
- O builder de evidence/report foi separado do lifecycle do worker quando o fluxo
  passou a lidar com varios manifests.
- Removidos os modelos intermediarios `CollectedManifest` e `PromotedManifest`;
  `ManifestEvidence` permanece apenas como projecao serializavel sem bytes.

Arquivos-chave:

- `src/stream-tools/hls-manifest.ts`
- `src/investigation/ports/manifest-collector.ts`
- `src/investigation/adapters/http-manifest-collector.ts`
- `src/investigation/application/build-manifest-evidence.ts`
- `src/investigation/application/run-investigation.ts`
- `src/investigation/domain/evidence.ts`

Checklist de validacao:

- [x] testes focados de parser, collector, SSRF derivado e worker;
- [x] `npm run check`;
- [x] `npm test` - 60 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] Compose reconstruido com API, worker, web e PostgreSQL saudaveis;
- [x] smoke Apple HLS: 5 variants descobertas, variant 3 selecionada por
  `BANDWIDTH=1927833`, media playlist com 181 segmentos descritos;
- [x] exatamente 2 artifacts preservados (`manifest/root` com 511 bytes e
  `manifest/variant/0` com 6701 bytes), sem download de chunks.

Pendencias:

- Nenhum init/media segment e baixado ainda.
- DASH permanece apenas com deteccao e contagem superficial.

Proximo passo recomendado:

- Amostrar poucos segmentos da variant selecionada e executar FFprobe local com
  timeout e argumentos estruturados.

### 2026-07-21 - Artifacts em lote e Evidence Bundle v2

Fase impactada: 2.

Entrega:

- Adicionada migration com `artifacts.logical_key` e unicidade parcial por
  investigation, sem invalidar artifacts historicos.
- Repository agora registra um lote de artifacts e o evidence bundle na mesma
  transacao.
- Retries substituem a mesma logical key; arquivos superados sao removidos somente
  depois do commit e arquivos nao registrados sao limpos em caso de rollback.
- Novas coletas geram `EvidenceBundle` v2 com arrays de manifests e media samples.
- Contratos backend e UI continuam aceitando reports v1 persistidos.
- Leitura de reports do PostgreSQL passou a validar o JSON persistido com Zod.

Arquivos-chave:

- `src/database/migrations/003_artifact_logical_keys.sql`
- `src/investigation/domain/evidence.ts`
- `src/investigation/ports/investigation-job.ts`
- `src/investigation/adapters/postgres-investigation-job.ts`
- `src/investigation/application/run-investigation.ts`
- `src/contracts/investigation.ts`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 52 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] migration aplicada em PostgreSQL 17 local;
- [x] Compose reconstruido e smoke HLS real concluido;
- [x] retry real concluiu na tentativa 2 mantendo exatamente um registro e um
  arquivo para `manifest/root`.

Pendencias:

- O lote atual ainda contem apenas o root manifest; a infraestrutura esta pronta
  para manifests derivados e media samples.

Proximo passo recomendado:

- Extrair variants/renditions HLS e preservar uma amostra limitada de manifests
  derivados usando as logical keys preparadas nesta entrega.

### 2026-07-21 - Primeira evidencia real e fronteira SSRF

Fase impactada: 2.

Entrega:

- Implementado cliente HTTP(S) com validacao de protocolo/credenciais, resolucao
  DNS completa e bloqueio de enderecos privados, locais e reservados.
- Requests conectam ao IP previamente validado, evitando segunda resolucao e DNS
  rebinding; redirects passam novamente pela policy.
- Adicionados timeout total, limite de redirects, limite de bytes e classificacao
  de falhas retryable/non-retryable.
- Criada deteccao deterministica inicial de HLS master/media e DASH MPD.
- Criados `ManifestCollector`, `ArtifactStore` e `EvidenceBundle` v1.
- Root manifest e gravado atomicamente no filesystem e registrado em PostgreSQL;
  arquivo nao registrado e removido em caso de rollback.
- Worker agora publica evidencia real e produz report
  `deterministic-manifest-v1`, preservando limitations e confidence limitada.
- UI diferencia fixture historica de report com evidencia observada.
- VHS foi inspecionado no commit `d2abfbd51046f1aed9737122b7e0e20f048efd91`,
  mas nenhum codigo foi copiado nesta fatia por faltar a fronteira SSRF necessaria.

Arquivos-chave:

- `src/stream-tools/safe-http-client.ts`
- `src/stream-tools/manifest.ts`
- `src/investigation/domain/evidence.ts`
- `src/investigation/ports/manifest-collector.ts`
- `src/investigation/adapters/filesystem-artifact-store.ts`
- `src/investigation/application/run-investigation.ts`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 48 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] stream HLS publico concluiu com 6 eventos, 1 artifact e 1 report;
- [x] master HLS real detectado com 5 variants e 511 bytes preservados;
- [x] tentativa contra `127.0.0.1` falhou uma unica vez com
  `STREAM_DESTINATION_BLOCKED` e zero artifacts;
- [x] API e worker encerraram graciosamente.

Pendencias:

- A deteccao ainda nao extrai atributos de variants/renditions/representations.
- Nenhum segmento ou manifest derivado e baixado nesta fatia.
- FFprobe, codecs, timestamps e playback continuam fora do report atual.

Proximo passo recomendado:

- Aprofundar o parser e selecionar manifests derivados com limites explicitos.

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
