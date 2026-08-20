# Project Status - Video Harness Space

Ultima atualizacao: **2026-08-19**

## Resumo

- Fase ativa: **Investigation Workspace**.
- Estado: **em andamento**.
- Repositorio: novo e independente.
- Runtime: API, worker e UI executaveis; persistencia local em arquivos
  JSON/JSONL (PostgreSQL eliminado).
- Objetivo imediato: persistir hipoteses no nivel da investigation para fechar o
  loop controlado, sem ampliar o produto para uma plataforma.
- Investigate produz e apresenta um baseline de qualidade ABR para HLS e DASH.
- DASH VOD esta em implementacao sobre o data plane ja comprovado.
- Closed-loop Experiments ja usam Investigation + Record para CONTROL/treatments,
  URL fixa no device, TestResults atribuidos e evaluation/follow-up.

## Fases

| Fase | Status | Objetivo |
|---|---|---|
| 0 | Concluida | Fundacao documental, decisoes e plano executavel |
| 1 | Concluida | Thin slice completo com API, worker, storage local, SSE e UI |
| 2 | Em andamento | Evidencia deterministica real de streaming |
| 3 | Em andamento | Investigacao assistida por IA e report estruturado |
| 4 | Planejada | UX premium e experiencia end-to-end |
| 5 | Planejada | Hardening, deploy e validacao com usuarios |
| Record R1 | Em andamento | HLS VOD, origem controlada e evidencia ABR por requests |
| Record R2 | Em andamento | DASH VOD sobre a fronteira comprovada em R1 |
| Workspace | Em andamento | Evidencia visual primeiro, agentes e loop de hipoteses |

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
- Amostragem HLS distribuida em inicio, meio e fim da playlist.
- Runtime Pi com tres especialistas isolados e Lead Investigator; sem chave de
  API, a investigation mantem o report deterministico com limitacao explicita.
- Boundary Pi tolerante a confidence nao finita e findings parcialmente
  malformados, com retry e observabilidade segura por agente.
- Compose local com alias restrito para investigar HLS servido em `localhost`,
  preservando o bloqueio SSRF para IPs e redirects privados.
- Media playlists submetidas diretamente agora amostram segmentos de inicio, meio
  e fim a partir do root.
- Suite local de evals gera fixtures HLS MPEG-TS temporarios com FFmpeg; nenhum
  binario de video e versionado no Git.
- Perfil forense DASH inicial expande MPDs estaticos, coleta a janela candidata
  de representations e inspeciona fMP4/HEVC de forma deterministica.
- Mudanca de escopo Record aprovada: Recording imutavel, PlaybackRun experimental,
  shaping compartilhado e evidencia ABR no nivel de request.
- Plano executavel de Record R1 e sequencia DASH R2 documentados.
- Slice 1 interno de Record: migration, dominio, intake idempotente, queries,
  SSE registravel, worker recuperavel e storage de staging com publish atomico.
- Slice 2 de Record: clone HLS VOD clear/MPEG-TS com ladder e audio vinculados,
  janela limitada, recursos registrados e intake habilitado na composicao.
- Slice 3 de Record: playback run com token hash e data plane GET que serve
  exclusivamente recursos registrados, sem origin fetch.
- Slice 4 de Record: profile v1 persistido e token bucket compartilhado por run
  com latencia por stage e emissao progressiva sob backpressure do stream.
- Slice 6 inicial de Record: homepage ativa e fluxo dedicado de intake, status,
  SSE e criacao/copia da URL de playback.
- Slice 5 inicial de Record: journal persistido de delivery e painel dos ultimos
  10 requests por playback run.
- Record R2 inicial: materializador DASH VOD estatico/fMP4, MPD local, init e
  segmentos registrados, URL `index.mpd` por playback run e seletor de protocolo
  no intake.
- URLs de playback fixas por recording em `/streams/recordings/:recordingId/*`;
  o run ativo e resolvido por request e o clone nunca fica inacessivel por
  lifecycle de run.
- Playback run aberto restaurado após refresh e encerramento explícito que
  finaliza o run (shaping e journal terminam; a URL permanece servindo baseline).
- Playback HLS/DASH explícito no dashboard Record, com hls.js/dash.js, checagem
  MSE de codecs DASH antes de baixar media e estados reais de playback/buffering.
- Data plane com preflight CORS, HEAD observacional, Range unico `206/416` e
  proxy `/streams` consistente em Nginx e Vite; somente GET avanca shaping e
  journal.
- ABR switching como entidade de primeira classe: candidatos URL-only e
  transicoes observadas carregam proveniencia distinta no mesmo
  `AbrSwitchEvidence`.
- MPD efetivo, ISO BMFF INIT/moof, hvcC/VPS/SPS/PPS, HEVC IRAP/SAP, timeline
  normalizada, semantic INIT diff, matrix e regras ABR com IDs estaveis.
- `AbrAssessment` protocol-neutral com ladder, cobertura, verdict, findings,
  transicoes e proximas medicoes em toda investigation HLS/DASH.
- Especialista `abr-switch-investigator` sempre ativo, com pacote compacto e sem
  exigir plataforma/player especificos; contexto colado na descricao permanece
  explicitamente relatado.
- Testes FFmpeg source standalone, target standalone, target boundary e switching
  compatibility (quando autorizado) entram automaticamente no candidato
  prioritario; falha da ferramenta vira limitacao, nao falha da investigation.
- Experiment/Hypothesis/Iteration/CloneSpec/TestRequest/TestResult/Evaluation
  persistidos pela migration 011, com budgets configuraveis e state transitions.
- CloneCompiler declarativo e recipes de selecao sobre o Record atual; modos de
  transcode/repackage/live proxy ficam explicitamente indisponiveis.
- Worker Record observa clones experimentais, verifica manifest/ladder/resources
  antes de `READY` e preserva spec/hash/plano/artifacts/timestamps/provenance.
- UI da Investigation cria CONTROL + treatment, mostra progresso, seleciona o
  tratamento servido, registra resultado estruturado e conclui/faz follow-up.
- Todos os tratamentos usam a mesma URL
  `/streams/experiments/:experimentId/*`; o usuario nao muda URL no device.

## Checklist da Fase 1

- [x] Definir contratos iniciais de investigation e intake.
- [x] Implementar repository PostgreSQL de intake.
- [x] Criar investigation, job e evento inicial em uma transacao.
- [x] Implementar claim, lease e heartbeat no worker.
- [x] Implementar historico e stream SSE.
- [x] Conectar o formulario da homepage ao fluxo real.
- [x] Exibir timeline persistida.
- [x] Exibir report placeholder.

## Pendencias da linha Investigate

- [x] Definir schema versionado do evidence bundle.
- [x] Criar port deterministico de coleta.
- [x] Proteger acesso de rede contra SSRF e redirects maliciosos.
- [x] Detectar HLS/DASH com timeout e limites.
- [x] Persistir o primeiro manifest como artifact.
- [x] Extrair estrutura profunda de variants/renditions HLS.
- [x] Coletar manifests HLS derivados com amostragem limitada.
- [x] Extrair representations DASH para a forense de Investigate; materializacao
  DASH para Record permanece em R2.
- [x] Coletar e analisar uma amostra limitada de segmentos HLS.

## Checklist Record R1

- [x] Aprovar HLS VOD antes de DASH VOD.
- [x] Separar Recording imutavel de PlaybackRun experimental.
- [x] Definir profile v1 e semantica de evidencia ABR.
- [x] Documentar endpoints, UX, arquitetura, riscos e Definition of Done.
- [x] Criar migrations, dominio e schemas Zod de Record.
- [x] Implementar intake idempotente, job recuperavel e SSE registravel.
- [x] Implementar storage com staging e publish atomico.
- [x] Importar/adaptar clone HLS VOD multi-variant do VHS.
- [x] Implementar data plane por token e recursos registrados.
- [x] Implementar shaping compartilhado com backpressure.
- [x] Persistir journal e derivar transicoes ABR.
- [ ] Entregar UX Record e smoke em device/player externo (UX inicial entregue;
  smoke externo ainda pendente).

## Proximo passo recomendado

Persistir hipoteses no nivel da investigation e permitir que uma pergunta crie
um pedido explicito de novo AgentRun sobre o snapshot, sem criar outro dashboard.

### 2026-08-19 - Persistencia local em arquivos JSON/JSONL sem PostgreSQL

Fases impactadas: todas (persistencia, worker, API, dados e UX).

Entrega:

- o PostgreSQL foi eliminado; toda persistencia usa arquivos locais JSON/JSONL
  atras de `src/store/` (`JsonStore`) com locks de diretorio, atomicidade por
  `temp + rename` e eventos append-only com sequencia monotonic a por agregado;
- `src/database/`, os adapters `postgres-*.ts` e a dependencia `pg` foram
  removidos; `db:migrate` e os servicos postgres do Compose deixaram de existir;
- jobs continuam recuperaveis (claim, lease e heartbeat) via locks de diretorio e
  arquivos de job JSON, replicando a semantica anterior sem banco;
- o health endpoint reporta `storage` em vez de `database` na API e na UI;
- API, worker e UI compartilham o mesmo `VIDEO_HARNESS_DATA_DIR`.

Arquivos-chave:

- `src/store/json-file.ts` (JsonStore, locks e append de eventos);
- `src/store/filesystem-health.ts`;
- `src/investigation/adapters/filesystem-*.ts`, `src/record/adapters/filesystem-*.ts`,
  `src/experiment/adapters/filesystem-*.ts`;
- `src/api/server.ts`, `src/api/index.ts`, `src/worker/index.ts`, `src/config.ts`;
- `compose.yml`, `compose.prod.yml`, `Makefile`, `package.json`, `README.md`;
- `docs/architecture/DECISIONS.md`,
  `docs/architecture/phases/phase-investigation-workspace.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 50 arquivos, 253 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`;
- [x] smoke real end-to-end em filesystem: health `storage up`, criacao de
  investigation com idempotencia (replayed=false e depois replayed=true), worker
  claimou o job, transicionou `queued -> validating -> collecting`, persistiu
  eventos com sequencia monotonic a, fez 3 tentativas e terminou em `failed`
  com `STREAM_DNS_FAILED` (falha ambiental do sandbox, sem rede externa);
  os artefatos `investigation.json`, `events.jsonl`, `seq.json` e o job JSON
  foram conferidos no disco.

Pendencias:

- smoke com um caso real completo com rede habilitada (intake, coleta, analise e
  playback) para confirmar a paridade com o fluxo PostgreSQL;
- revisar `docs/api.md` para remover mencoes residuais a `database` e ao
  PostgreSQL no fluxo de setup.

Proximo passo recomendado:

- executar um smoke end-to-end no ambiente local com o storage em arquivos e,
  em seguida, retomar a persistencia de Hypothesis no nivel da investigation.

### 2026-08-16 - Record e cenarios de resiliencia unificados

Fases impactadas: Record R1/R2 e UX.

Entrega:

- removidos o card, a rota e a pagina independentes de Samples;
- os quatro cenarios de resiliencia agora sao selecionaveis no intake e no
  dashboard de Record, usando o mesmo `PlaybackRun` e `FaultPlan`;
- removido o preset de rede `1080p control` da UI; controle de representation
  continua pertencendo a Experiment/CloneSpec.

Arquivos-chave:

- `ui/src/pages/RecordPage.tsx`;
- `ui/src/pages/HomePage.tsx`;
- `ui/src/App.tsx`;
- `ui/src/lib/api.ts`;
- `docs/ui/UI-GUIDE.md`;
- `docs/api.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 50 arquivos, 253 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- smoke com player/device externo continua pendente;
- cenarios de resiliencia ainda cobrem delivery, nao decode/render ou DNS real.

Proximo passo recomendado:

- validar o fluxo Record unificado em mobile e com um player externo.

### 2026-08-15 - FaultPlan v1 auditavel em PlaybackRun

Fases impactadas: Record R1 e Investigation Workspace.

Entrega:

- `PlaybackRun` aceita `FaultPlan` versionado, separado do profile de rede;
- regras deterministicas selecionam somente recursos publicados por tipo, target
  e media sequence; paths e origem nao sao entradas da regra;
- o data plane aplica atraso extra, status HTTP ou truncamento de body e o
  journal persiste a regra/acao efetivamente aplicada;
- o contrato deixa explicitas as limitacoes: delivery nao prova render/decode e
  timeout HTTP nao e falha DNS real do device.

Arquivos-chave:

- `src/record/application/fault-plan.ts`;
- `src/api/routes/streams.ts`;
- `src/database/migrations/016_playback_fault_plans.sql`;
- `docs/api.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 49 arquivos, 250 testes;
- [x] `npm --prefix ui run check` (sem mudanca de UI);
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- gerar fixture A/V de referencia e alternates registrados para black screen,
  silencio e offset de lip-sync;
- correlacionar eventos reais do player com o journal.

Proximo passo recomendado:

- expor presets de FaultPlan na superficie Validate depois de definir os
  cenarios de referencia A/V.

### 2026-08-15 - Samples de resiliencia acessiveis pela home

Fases impactadas: Record R1 e UX.

Entrega:

- card `Samples` ativo na home e rota `/samples` com quatro cenarios v1;
- cada cenario leva ao intake Record e preserva a selecao na URL ate o dashboard;
- quando a VOD fica pronta, `Run resilience sample` cria um playback run com o
  `FaultPlan` correspondente e o journal continua como evidencia auditavel.

Arquivos-chave:

- `ui/src/pages/HomePage.tsx`;
- `ui/src/pages/SamplesPage.tsx`;
- `ui/src/pages/RecordPage.tsx`;
- `ui/src/lib/api.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `npm test` - 49 arquivos, 250 testes;
- [x] `git diff --check`.

Pendencias:

- fonte A/V de referencia autocontida e cenarios perceptiveis de black/silent/
  lip-sync;
- teste de interface automatizado para a rota Samples.

Proximo passo recomendado:

- materializar a fixture de referencia e substituir os samples de request por
  cenarios end-to-end de playback.

### 2026-08-15 - Falha HTTP intermitente e metrica de recovery

Fases impactadas: Record R1 e UX.

Entrega:

- `FaultRule.everyNthMatch` permite aplicar uma falha em cadencia limitada; os
  samples 503 e 404 falham a cada quatro requests de video;
- o contador considera tentativas de delivery correspondentes, inclusive retries;
  falhas aplicadas continuam persistidas no journal;
- dashboard conta `Injected faults` e identifica a regra/acao em cada request
  afetada para comparar com o comportamento de recuperacao do player.

Arquivos-chave:

- `src/record/application/fault-plan.ts`;
- `src/api/routes/streams.ts`;
- `ui/src/pages/SamplesPage.tsx`;
- `ui/src/pages/RecordPage.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 49 arquivos, 251 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- persistir o contador de cadencia para sobreviver a restart da API, como um
  proximo endurecimento do data plane;
- correlacionar a falha entregue com eventos de retry/buffering do player.

Proximo passo recomendado:

- adicionar telemetria de player ao run para mostrar se o player recuperou apos
  cada falha intermitente, sem inferir render quando ela estiver ausente.

### 2026-08-15 - Gestao de storage de Recordings

Fases impactadas: Record R1 e UX.

Entrega:

- `GET /v1/recordings` lista recordings locais e bytes registrados;
- `DELETE /v1/recordings/:id` remove primeiro a midia publicada e workspace e
  depois a linha do banco, evitando media orfa apos uma exclusao confirmada;
- `/recordings` mostra a ocupacao total dos registros, permite abrir ou apagar
  com confirmacao e protege clones pertencentes a Experiments.

Arquivos-chave:

- `src/record/application/delete-recording.ts`;
- `src/record/adapters/postgres-recording-deletion.ts`;
- `ui/src/pages/RecordingsPage.tsx`;
- `docs/api.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 50 arquivos, 253 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- politica opcional de retencao/limpeza por idade e limite total de disco;
- telemetria de espaco livre do filesystem para alertar antes do limite do VPS.

Proximo passo recomendado:

- definir um budget de storage e avisar no intake antes de aceitar um recording
  que pode ultrapassa-lo.

### 2026-08-15 - Pistas exclusivas e custo auditavel da equipe de agentes

Fases impactadas: 3 e Investigation Workspace.

Entrega:

- timeline, container e manifest/delivery recebem pacotes e `evidenceIndex`
  exclusivos; o resumo ABR deterministico continua compacto e serve apenas como
  contexto anti-eco;
- prompts declaram a pista exclusiva e findings citados fora dela sao removidos
  antes do Lead, que recebe somente os achados filtrados para deduplicar;
- cada `agent_run` agora persiste bytes do pacote, quantidade de fatos citaveis
  e sobreposicao de IDs com outras pistas; o painel mostra essas medidas;
- migration 015 adiciona `packet_metrics` sem mudar o report compartilhavel ou
  registrar chain of thought.

Arquivos-chave:

- `src/investigation/adapters/pi-investigation-ai.ts`;
- `src/agents/application/run-agent-team.ts`;
- `src/database/migrations/015_agent_run_packet_metrics.sql`;
- `ui/src/components/InvestigationWorkspace.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 48 arquivos, 246 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- smoke com um caso real apos aplicar a migration 015, para medir a reducao de
  bytes e a sobreposicao em uma analise persistida.

Proximo passo recomendado:

- decidir se a selecao condicional de somente duas pistas deve substituir a
  equipe completa em casos de baixa complexidade.

### 2026-08-15 - Painel de agentes restaurado com auditoria completa

Fases impactadas: 3, 4 e Investigation Workspace.

Entrega:

- o painel `Agent panel` abaixo do report volta a abrir por padrao depois de
  `completed`, restaurando o acesso direto a auditoria por agente que o corte
  orientado pelo estado havia recolhido em uma superficie recolhida;
- o trilho lateral continua como seletor de especialista e o conteudo principal
  mostra o run persistido de cada um: todas as tentativas (`Attempt N`),
  provider/modelo, estado, `Input · evidence packet` (o pacote de evidencia
  recebido), `System prompt`, tools disponiveis, tool calls com input e
  resultado, e `Validated output`;
- a mesma inspecao completa vale durante a execucao em `LiveAnalysis`, refletindo
  os runs que terminam contra o snapshot;
- para o `manifest-delivery`, o painel extrai do input packet a secao
  `Manifest content sent inline` (texto cru por logicalKey), provando que o
  conteudo dos manifests chega ao agente; verificacao no caso
  `be1e1951-ce5c-4af9-ab31-ab5fecebb40e` confirmou os 10 manifests com `content`
  no prompt persistido (330.183 chars), incluindo o master e as playlists de
  variant;
- o container web foi reconstruido e reiniciado; o bundle anterior nao exibia o
  input packet, o que fazia parecer que o agente nao recebia o conteudo;
- a regra de fronteira permanece: chain of thought e raciocinio bruto do modelo
  nunca entram na auditoria nem no report compartilhavel.

Arquivos-chave:

- `ui/src/components/InvestigationWorkspace.tsx`;
- `docs/ui/UI-GUIDE.md`;
- `docs/architecture/phases/phase-investigation-workspace.md`.

Validacoes:

- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `npm run check`;
- [x] `npm test` - 48 arquivos, 244 testes;
- [x] `git diff --check`;
- [x] API `/ai-runs` devolve o prompt com `content` dos 10 manifests no caso
  `be1e1951`;
- [x] rebuild do container web e navegacao HTTP 200 com o bundle novo;
- [ ] smoke visual real com um caso `completed` (depende de caso com agentes
  persistidos no ambiente atual).

Pendencias:

- nenhuma especifica desta entrega.

Proximo passo recomendado:

- retomar a persistencia de Hypothesis no nivel da investigation.

### 2026-08-15 - CONTROL full-ladder e validacao desenhada pelo Lead

Fases impactadas: 3, 4, Record R1/R2 e Investigation Workspace.

Entrega:

- o teto de seguranca de Record passou de 8 para 32 video
  variants/representations; CONTROL preserva toda a ladder selecionada e continua
  limitado por duracao, bytes, recursos, SSRF e publish atomico;
- HLS e DASH aplicam o limite depois da selecao do CloneSpec, de modo que um
  treatment pequeno nao falha apenas porque a origem declara uma ladder maior;
- a coleta Investigate tambem abre ate 32 playlists de variant, evitando declarar
  a variant mais alta como selecionada sem sequer coletar seu media playlist;
- o Lead Investigator agora devolve `validationPlan` com goal, hipotese,
  rationale, proof boundary, recipe, label e IDs exatos de representations;
- `representation_subset` permite tratamentos causais como `AAC-ONLY`,
  preservando apenas as renditions vinculadas ao grupo selecionado;
- downloads HLS de media agora repetem somente o recurso que sofreu uma falha
  transitoria; o job nao reinicia toda a ladder depois de dezenas de variants ja
  materializadas;
- Validate deixou de usar LOW-BR como template universal. LOW-BR fica restrito a
  diagnosticos de pressao de entrega; codec/audio group e representation usam
  tratamentos proprios, e causas sem capability ficam sem plano automatico;
- `POST /v1/investigations/:id/analysis` aceita `{ "rerun": true }` depois de
  `completed`, mantendo chamadas comuns idempotentes;
- a investigation `be1e1951-ce5c-4af9-ab31-ab5fecebb40e` foi reanalisada pelos
  cinco agentes. O Lead criou a hipotese AAC versus E-AC-3 e selecionou
  `variant-0` a `variant-4` para `AAC-ONLY`;
- o primeiro Experiment substituto `0b3587e5-4737-40c5-be86-467a422c32eb`
  confirmou o AAC-ONLY, mas preservou em auditoria uma falha transitoria de DNS
  sofrida pelo CONTROL antes do retry por recurso;
- o smoke limpo `a4b2ad29-80c4-4fee-a0df-f47c0bf31653` terminou com CONTROL
  `READY` e verificado em 10 video variants/3 audios (120.032 s, 276 recursos) e
  AAC-ONLY `READY` e verificado em 5 video variants/2 audios (120.12 s, 150
  recursos). A falha DNS real em um segmento do CONTROL foi recuperada dentro da
  mesma tentativa;
- a URL permanente foi alternada entre os dois TestRequests: serviu 10/3 no
  CONTROL e 5/2 no AAC-ONLY. O treatment ficou selecionado, sem registrar um
  resultado de device que ainda nao foi observado. Os experiments anteriores
  permanecem como historico auditavel.

Arquivos-chave:

- `src/agents/domain/prompts.ts`;
- `src/agents/domain/parsing.ts`;
- `src/agents/application/run-agent-team.ts`;
- `src/experiment/application/clone-compiler.ts`;
- `src/record/adapters/hls-vod-materializer.ts`;
- `src/record/adapters/dash-vod-materializer.ts`;
- `src/investigation/adapters/http-manifest-collector.ts`;
- `ui/src/components/InvestigationExperiments.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 48 arquivos, 244 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] reanalise real com cinco agentes `completed` e plano `AAC-ONLY` validado
  contra os IDs da evidencia;
- [x] smoke real: CONTROL 10/3 e AAC-ONLY 5/2 `READY`, verificacao `PASSED` e
  mesma URL permanente conferida para ambas as selecoes;
- [x] API/worker/web locais atualizados; `/v1/health` respondeu `ok` com banco
  `up` e a URL permanente continuou servindo o AAC-ONLY 5/2 apos o recreate;
- [x] `git diff --check`.

Pendencias:

- preservar a ladder inteira aumenta o tempo e o volume do clone; a proxima
  evolucao de performance deve paralelizar targets sob um budget agregado, sem
  remover variants silenciosamente;
- request journal e telemetria atribuida do device continuam necessarios para
  provar a troca AAC/E-AC-3 e o mecanismo de decode/render.

Proximo passo recomendado:

- reproduzir CONTROL e AAC-ONLY no mesmo AVPlay/VLC e anexar request journal,
  eventos de buffer e erro de decoder ao TestRequest selecionado.

### 2026-08-15 - Pagina de investigations com abertura e delecao completa

Fases impactadas: API, dados, storage e UX Investigate.

Entrega:

- `GET /v1/investigations` lista os cases (mais recentes primeiro) para o
  workspace;
- `DELETE /v1/investigations/:id` apaga a investigation e tudo que o banco
  cascateia (jobs, eventos, artifacts, reports, snapshots, agent runs, playback
  sessions, shell runs, experiments e recordings vinculadas) e remove do
  filesystem os artifacts, o workspace lab e os workspaces/recordings dos
  experiments;
- a limpeza de filesystem e best-effort: uma falha de disco nao transforma uma
  delecao confirmada no banco em erro;
- pagina `/investigations` na UI lista os cases com `Open`, `Delete` e
  confirmacao explicita, estados, data e descricao do problema;
- o card Investigate da home navega para a lista; o formulario da home continua
  criando cases novos.

Arquivos-chave:

- `src/investigation/ports/investigation-deletion.ts`,
  `src/investigation/adapters/postgres-investigation-deletion.ts`,
  `src/investigation/adapters/filesystem-investigation-cleanup.ts`,
  `src/investigation/application/delete-investigation.ts`;
- `src/investigation/ports/investigation-query.ts`,
  `src/investigation/adapters/postgres-investigation-query.ts`,
  `src/investigation/application/investigation-queries.ts`;
- `src/api/routes/investigations.ts`, `src/api/server.ts`, `src/api/index.ts`;
- `ui/src/pages/InvestigationsPage.tsx`, `ui/src/App.tsx`,
  `ui/src/pages/HomePage.tsx`, `ui/src/lib/api.ts`;
- `docs/api.md`, `docs/ui/UI-GUIDE.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 48 arquivos, 237 testes (inclui novos testes de delete da
  API e do service);
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`;
- [x] smoke real no Compose: investigation criada via API, artifacts e lab
  workspace confirmados no volume, `DELETE` removeu DB (todas as tabelas) e
  arquivos; delete repetido retornou 404;
- [x] smoke de delecao em caso ainda em `collecting`.

Pendencias:

- smoke visual headless da pagina de lista (Chromium nao subiu no ambiente atual
  por sandbox/snap);
- rebuild do web no Compose ja feito; validar navegacao na UI real.

### 2026-08-15 - Avaliacao pos-experimento por equipe de agentes

Fases impactadas: 3, 4, Record/ABR e Investigation Workspace.

Entrega:

- o endpoint de avaliacao passou a criar um job persistido e recuperavel, em vez
  de concluir o experimento de forma sincrona com um texto deterministico;
- uma camada factual compara CONTROL e tratamentos, limita o escopo causal e
  classifica `CONTROL FAIL + LOW-BR PASS` como evidencia parcial, sem transformar
  reducao de demanda em prova de latencia de origem;
- tres agentes especializados executam a avaliacao: Evidence Auditor, Causal
  Analyst e Lead Experiment Investigator;
- o contrato do Lead inclui `causalScope`, validado contra o guardrail factual
  para rejeitar conclusoes causalmente mais fortes que os dados;
- a migration `014_experiment_agent_evaluations.sql` persiste jobs, analise
  estruturada, retries, lease e os estados dos agentes;
- Validate mostra o progresso real dos agentes e apresenta observacao, suporte,
  limites, alternativas, confianca e proximo teste antes da evidencia bruta;
- avaliacoes antigas recebem `Reanalyze with agents`, e formularios/provenance
  ficam recolhidos quando ja existe resultado;
- o experimento `ae4cb20e-684d-4faa-982e-322b9f55948f` foi reanalisado no ambiente
  local: os tres agentes concluiram, H1 ficou `PARTIALLY_SUPPORTED` e a avaliacao
  ficou `MORE_TESTS_REQUIRED`.

Arquivos-chave:

- `src/experiment/application/evaluate-experiment.ts`;
- `src/experiment/application/run-experiment-evaluation.ts`;
- `src/experiment/adapters/pi-experiment-analysis.ts`;
- `src/experiment/adapters/postgres-experiment-evaluation-job.ts`;
- `src/database/migrations/014_experiment_agent_evaluations.sql`;
- `ui/src/components/InvestigationExperiments.tsx`;
- `ui/src/lib/api.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 47 arquivos, 230 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`;
- [x] migration 014 aplicada via Docker Compose e API saudavel;
- [x] smoke real com uma resposta HTTP 200 do provedor para cada um dos tres
  agentes e `completedAgents: 3` no worker;
- [x] validacao do DOM da pagina real: sintese causal visivel, nenhuma secao
  tecnica aberta por padrao e formulario de nova validacao recolhido.

Pendencias:

- associar automaticamente cada TestRequest a um PlaybackRun com journal e
  telemetria do device; sem isso a equipe avalia somente o resultado reportado e
  a transformacao aplicada;
- persistir o prompt audit completo desta equipe pode ser um corte posterior; a
  analise estruturada e os estados dos agentes ja ficam persistidos.

Proximo passo recomendado:

- criar o PlaybackRun atribuido ao TestRequest ativo e anexar request journal e
  telemetria observada ao snapshot entregue ao Evidence Auditor.

### 2026-08-15 - Investigation Workspace reorganizado por intencao do usuario

Fases impactadas: 3, 4 e Investigation Workspace.

Entrega:

- a navegacao do caso agora explicita `Stream data -> Diagnosis -> Validate`, com
  Validate opcional e persistido em `?view=validate`;
- durante a execucao Diagnosis continua mostrando atividade real; depois de
  `completed`, abre pelo report e recolhe timeline, agentes e prompt audit em uma
  unica superficie de auditoria;
- findings deixaram de ser apresentados incorretamente como hipoteses; uma
  hipotese real nasce somente dentro do Experiment;
- `Ask the agents` virou `Question for the next analysis` e informa que apenas
  persiste a pergunta, sem sugerir uma chamada imediata ao modelo;
- Experiments saiu do rodape escuro e passou a compor Validate dentro da mesma
  superficie clara do workspace;
- Validate recebe a causa provavel como contexto, cria uma hipotese falsificavel
  sobre CONTROL versus LOW-BR e explicita que esse tratamento nao reproduz
  latencia de origem nem prova decode/render sem resultado do device;
- a pagina concluida caiu de aproximadamente 4.308 px para 2.538 px no caso real,
  com a conclusao visivel na primeira viewport e a auditoria recolhida.

Arquivos-chave:

- `ui/src/pages/InvestigationPage.tsx`;
- `ui/src/components/InvestigationWorkspace.tsx`;
- `ui/src/components/InvestigationReport.tsx`;
- `ui/src/components/InvestigationExperiments.tsx`;
- `docs/ui/UI-GUIDE.md`;
- `docs/architecture/phases/phase-investigation-workspace.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 223 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] revisao visual real em 1440x1200 de Diagnosis e Validate pelo Chrome
  DevTools Protocol;
- [x] `git diff --check`.

Pendencias:

- a persistencia de Hypothesis no nivel da investigation e o novo AgentRun a
  partir de pergunta continuam como proximos cortes; esta entrega nao simula
  nenhum dos dois.

Proximo passo recomendado:

- permitir que um finding/causa provavel seja promovido explicitamente a uma
  Hypothesis persistida antes de compilar tratamentos adicionais.

### 2026-08-15 - Ladder preserva as variants realmente amostradas no explorer

Fases impactadas: 2, Workspace e UX Investigate.

Entrega:

- diagnostico: `selection.variantLogicalKey` apontava para a primeira variant
  coletada (`manifest/variant/0`) em vez da variant selecionada por maior
  bandwidth; o explorer ainda dependia so desse campo e ignorava
  `sampledVariants`, entao variants com chunks preservados apareciam como
  `Not preserved in this pass / 0 preserved`;
- backend: `variantLogicalKey` agora aponta para a variant selecionada
  (`manifest/variant/<variantIndex>`), mantendo `sampledVariants` como fonte de
  verdade das variants preservadas;
- UI: `buildLadderRows` resolve o logicalKey por variant a partir de
  `sampledVariants` (com fallback para `variantLogicalKey`), vinculando as
  samples preservadas as linhas corretas;
- smoke real `e85303a1-6fe6-4b44-a1a0-a3e3dc164ca8`: variantes 3 e 4 agora
  mostram 4 e 10 chunks preservados, respectivamente.

Arquivos-chave:

- `src/investigation/application/build-manifest-evidence.ts`;
- `ui/src/components/DeterministicStreamExplorer.tsx`;
- `src/investigation/application/run-investigation.test.ts`.

Validacoes:

- [x] `npm run check`;
- [x] testes direcionados de `run-investigation` - 12 testes, incluindo o novo
  caso da variant selecionada != primeira (falha sem o fix);
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- rebuild do web no Compose para o caso real refletir a correcao sem re-coleta;
- o teste `evaluate-experiment.test.ts` falha por mudanca pre-existente no
  working tree (avaliacao migrada para job assincrono), sem relacao com esta
  entrega.

### 2026-08-15 - Especialista de timeline recebe as janelas de continuidade

Fases impactadas: 3 e Investigation Workspace.

Entrega:

- `evidence.timeline` (janelas deterministicas de continuidade com gaps/overlaps
  por variant) entra no evidence index como `timeline:<key>`, permitindo que os
  findings citem cada janela;
- a especialista `timeline-playback` passa a receber uma packet dedicada com o
  array `timeline` inline, enquanto as demais agentes mantem o pacote compacto;
- prompt proprio da especialista instrui a ler as janelas deterministicas antes
  de afirmar continuidade e a declarar limitacao quando o snapshot historico nao
  possui o campo;
- snapshots historicos sem `timeline` continuam validos e sao tratados como
  limitacao explicita.

Arquivos-chave:

- `src/investigation/adapters/pi-investigation-ai.ts`;
- `src/agents/application/run-agent-team.ts`;
- `src/agents/domain/prompts.ts`;
- `src/investigation/adapters/pi-investigation-ai.test.ts`;
- `src/agents/README.md`;
- `docs/architecture/README.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 224 testes;
- [x] `npm --prefix ui run check`;
- [x] `git diff --check`.

Pendencias:

- smoke real com a especialista `timeline-playback` no provider configurado.

Proximo passo recomendado:

- persistir Hypothesis no nivel da investigation, mantendo as packets dedicadas
  como fonte inline de evidencia deterministica.

### 2026-08-15 - Especialista de manifesto recebe o conteudo dos manifests

Fases impactadas: 3 e Investigation Workspace.

Entrega:

- `ManifestEvidence` agora preserva `content` com o texto cru do manifest,
  limitado a 32.768 caracteres com marcador de truncamento explicito; snapshots
  historicos sem o campo continuam validos;
- a packet compartilhada continua compacta e sem o corpo dos manifests; a
  especialista `manifest-delivery` passa a receber uma packet dedicada com
  `evidence.manifests[].content` por logicalKey, permitindo verificar topologia,
  atributos declarados e fatos de delivery no texto real;
- a projecao do report remove `content` dos manifests, preservando a regra de que
  o corpo baixado nao trafega na projecao compartilhavel;
- prompt proprio da especialista `manifest-delivery` instrui a ler o conteudo
  inline e a declarar limitacao quando o snapshot historico nao o possui.

Arquivos-chave:

- `src/investigation/domain/evidence.ts`;
- `src/investigation/application/build-manifest-evidence.ts`;
- `src/investigation/adapters/pi-investigation-ai.ts`;
- `src/agents/application/run-agent-team.ts`;
- `src/agents/domain/prompts.ts`;
- `src/contracts/investigation.ts`;
- `ui/src/lib/api.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 223 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- smoke real com a especialista `manifest-delivery` para confirmar o uso do
  conteudo inline no provider configurado.

Proximo passo recomendado:

- smoke real do fluxo de analise com manifests reais e, depois, persistir
  Hypothesis no nivel da investigation.

### 2026-08-15 - Confiabilidade da equipe de agentes

Fases impactadas: 3 e Investigation Workspace.

Entrega:

- os quatro especialistas agora usam a credencial compartilhada em serie; uma
  correcao de JSON nao cria mais um burst concorrente que limita os agentes
  seguintes;
- retries distinguem contrato, rate limit, falha transiente e erro permanente;
  429 usa hint do provider quando existe e backoff limitado quando nao existe;
- os parsers aceitam envelopes comuns, aliases camel/snake case, confidence
  numerica/string e listas escalares, preservando summary obrigatorio e removendo
  findings sem evidence IDs conhecidos;
- o contrato ABR recebeu a mesma tolerancia controlada, com defaults conservadores
  (`INCONCLUSIVE`/`LOW`) para campos ausentes, sem promover root cause sem citacao;
- o pacote repetido para os modelos remove URLs e listas completas de frames/NALs;
  contagens e boundaries compactos ficam no prompt, enquanto o detalhe completo
  permanece no snapshot e em `inspect_preserved_sample`;
- logs de falha de validacao registram somente paths/codigos do schema, nunca o
  conteudo bruto ou raciocinio do modelo;
- smoke real com evidencia sintetica minima no provider/model configurado concluiu
  timeline, container, manifest, ABR e Lead, com cinco AgentRuns na primeira
  tentativa, nenhum 429 e nenhum agente falho.

Arquivos-chave:

- `src/agents/application/run-agent-team.ts`;
- `src/agents/domain/parsing.ts`, `errors.ts`;
- `src/agents/application/abr-quality-investigator-agent.ts`;
- `src/agents/adapters/pi-model-runner.ts`;
- `src/investigation/adapters/pi-investigation-ai.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 221 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] smoke real do boundary Pi com cinco agentes completos, cinco attempts e
  zero failures;
- [x] `git diff --check`.

Pendencias:

- repetir a analise do snapshot que exibiu as falhas depois de publicar/reiniciar
  o worker com esta versao; o smoke nao reutilizou evidencia real do usuario.

Proximo passo recomendado:

- publicar o worker e solicitar novamente Agent analysis no caso afetado; depois,
  retomar a persistencia de Hypothesis no nivel da investigation.

### 2026-08-15 - Report final restaurado no Investigation Workspace

Fases impactadas: 3, 4 e Investigation Workspace.

Entrega:

- confirmada no caso `2f013658-2bc2-42f4-851e-03ca4453acf2` a existencia do
  report persistido e valido na API; a regressao estava somente na composicao da
  UI criada para o workspace;
- a etapa `Agent analysis` volta a terminar com um report final visivel, agora
  adaptado a superficie clara do workspace e sem restaurar o layout legado;
- summary, confianca, causa provavel, recomendacoes, findings, checks
  deterministicos e limitacoes aparecem antes de Experiments;
- estados de carregamento e erro da consulta do report sao apresentados de forma
  explicita, evitando que uma falha pareca ausencia silenciosa de conteudo.

Arquivos-chave:

- `ui/src/components/InvestigationReport.tsx`;
- `ui/src/components/InvestigationWorkspace.tsx`;
- `ui/src/pages/InvestigationPage.tsx`;
- `docs/ui/UI-GUIDE.md`.

Validacoes:

- [x] parse do report real pela fronteira Zod da UI;
- [x] renderizacao estatica do componente com o report real - todas as secoes
  esperadas presentes;
- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 221 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] rebuild do container web local e confirmacao do bundle novo em
  `localhost:5173`;
- [x] `git diff --check`.

Pendencias:

- nenhuma especifica desta correcao.

Proximo passo recomendado:

- retomar a persistencia de Hypothesis no nivel da investigation.

### 2026-08-15 - Observabilidade do worker: progresso deterministico no logger

Fases impactadas: 2, 3, Record R1/R2, Workspace e worker.

Entrega:

- o worker passou a emitir logs estruturados e seguros no stdout, em vez de
  depender apenas do PostgreSQL/SSE: `worker.job_claimed`, `job.state_changed`
  por estagio, `collection_limited`, `media_probe_failed`,
  `abr_decode_tests_unavailable`, `analysis_unavailable`, `resource_retry`,
  `evidence_ready`, `report_ready`, `recording.ready`, `playback.review_completed`
  e `worker.job_failed`;
- os tres workers de aplicacao (`run-investigation.ts`, `run-investigation-analysis.ts`
  e `run-recording.ts`) e o `run-playback-review.ts` recebem um `logger`
  opcional injetado, com default no-op que preserva os testes;
- nenhuma URL assinada e nenhum path de request e registrado; os logs usam IDs,
  estagios, contagens, error codes e disposicao de retry, sem linha por byte/chunk;
- o job de coleta fecha com um sumario equivalente ao smoke: protocol,
  `manifestCount`, `mediaSampleCount`, `probeCount`, `limitationCount` e
  `snapshotId`, correlacionando log e SSE;
- falhas terminam com `worker.job_failed` trazendo `code`, `retryable`,
  `disposition` (Record) e mensagem truncada em 500 caracteres.

Arquivos-chave:

- `src/infra/logger.ts` (tipo `WorkerLogger`);
- `src/investigation/application/run-investigation.ts`,
  `run-investigation-analysis.ts`, `run-playback-review.ts`;
- `src/record/application/run-recording.ts`;
- `src/worker/index.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 216 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- nenhuma especifica desta entrega.

Proximo passo recomendado:

- persistir Hypothesis no nivel da investigation, mantendo a observabilidade
  nova como trilha de correlacao para o passe deterministico.

### 2026-08-15 - Abertura visual da investigation durante a coleta

Fases impactadas: Workspace e UX Investigate.

Entrega:

- o placeholder tecnico amarelo que abria a tela foi substituido por uma
  composicao de investigacao em andamento integrada a folha clara do workspace;
- headline, atividade atual e quatro marcos do passe acompanham os estados
  persistidos e os eventos reais de `collection`, sem percentual ou prazo
  inventado;
- o estado inicial mantem o problema relatado visivel, comunica a fronteira
  facts-first e diferencia conexao SSE, limitations e falha terminal;
- a composicao e responsiva e preserva os estados `queued`, `validating`,
  `collecting`, `evidence_ready` e `failed` enquanto o explorer ainda nao abriu.

Arquivos-chave:

- `ui/src/components/InvestigationWorkspace.tsx`;
- `docs/ui/UI-GUIDE.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 210 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] smoke visual headless do estado `collecting` em 1440x1000 e 390x844 com
  API/SSE mock;
- [x] `git diff --check`.

Pendencias:

- nenhuma especifica desta entrega.

Proximo passo recomendado:

- persistir Hypothesis no nivel da investigation, mantendo esta abertura como
  feedback visual do passe deterministico.

### 2026-08-15 - Evidencia deterministica rica e apresentacao no workspace

Fases impactadas: 2, 3, Workspace, API, dados e UX Investigate.

Entrega:

- HTTP/network facts capturados na coleta (latencia, first-byte, redirects e
  headers finais) agora trafegam por manifest e media sample ate o evidence
  bundle e o report; `SafeHttpClient` mede timing real em volta do requester.
- O coletor de manifests HLS busca as playlists de todas as variants da ladder
  (ate 8, texto), com falha isolada por variant virando limitation; a amostragem
  de media cobre a variant selecionada e a vizinha de menor bandwidth, dentro de
  uma janela compartilhada, alem da rendition de audio.
- `hls.topology` resume a topologia declarada por variant e observacoes novas
  detectam target-duration e discontinuity mismatches; `selection.sampledVariants`
  lista as variants preservadas.
- Sanidade estrutural MPEG-TS deterministica por chunk (`probe.structural`):
  sync errors, PAT/PMT/PCR, continuities e truncamento.
- DRM classificado (`widevine`/`playready`/`fairplay`/`clearkey`) a partir dos
  system IDs do init, com observacao e limitation explicita de ciphertext.
- `abr.capability` projeta o decoder necessario por rung da ladder (perfil/nivel
  AVC e HEVC, resolucao maxima) e um aviso para niveis altos (>= 5.1).
- `timeline` reune fatos de continuidade entre chunks contiguos
  (gaps/overlaps de apresentacao por variante/audio).
- Correlacao de playback: o worker de analise anexa `playbackSwitches`
  observados (`PLAYBACK_NETWORK_OBSERVED`) do journal de playback runs de
  recordings relacionados via Experiments; somente dados persistidos sao usados.
- O explorer deterministico apresenta os novos fatos em seccoes dedicadas
  (`Delivery facts`, `Ladder alignment`, `Timeline continuity`, `Observed
  playback switches`), decoder requerido e badges de DRM no header, e
  `Container structure`/`Delivery` no inspector de chunk; tudo opcional e
  somente quando medido.

Arquivos-chave:

- `src/stream-tools/safe-http-client.ts`, `ts-sanity.ts`, `isobmff.ts`;
- `src/investigation/adapters/http-manifest-collector.ts`,
  `http-media-sample-collector.ts`, `ffprobe-media-probe.ts`,
  `filesystem-lab-workspace.ts`, `postgres-playback-correlation.ts`;
- `src/investigation/application/build-manifest-evidence.ts`,
  `run-investigation-analysis.ts`, `analyze-timeline-continuity.ts`;
- `src/abr/application/project-decoder-capability.ts`, `src/abr/domain/assessment.ts`;
- `src/contracts/investigation.ts`, `src/contracts/abr.ts`;
- `ui/src/components/DeterministicStreamExplorer.tsx`, `ui/src/lib/api.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 45 arquivos, 210 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`.

Pendencias:

- smoke visual headless HLS/DASH real para conferir as novas seccoes do explorer
  com manifests e chunks reais;
- `InvestigationReport` nao existe mais como componente proprio; a sintese e o
  replay continuam pela etapa de agentes e Experiments.

Proximo passo recomendado:

- smoke visual headless e, depois, persistir Hypothesis no nivel da
  investigation (proximo corte do workspace).

### 2026-08-14 - Coleta deterministica antes da analise dos agentes

Fases impactadas: Workspace, worker, API, dados e UX Investigate.

Entrega:

- a investigation agora possui duas etapas reais e navegaveis: `Stream data` em
  largura total e `Agent analysis` com agentes, timeline, hipoteses e perguntas;
- o job inicial para em `evidence_ready` depois de persistir artifacts e um
  `evidence_snapshot`; nenhum agente e chamado e nenhum report e criado nessa etapa;
- `POST /v1/investigations/:id/analysis` cria de forma idempotente o segundo job,
  muda o caso para `analysis_queued` e referencia o snapshot deterministico atual;
- o analysis worker publica progresso real por agente, persiste prompt/tool
  calls/output em `agent_runs` e somente entao sintetiza o report final;
- falha terminal do segundo job preserva a evidencia e devolve o caso a
  `evidence_ready`, em vez de inutilizar a investigation inteira;
- Experiments aparece apenas na etapa de agentes e depois do report; o CTA de
  replay aparece somente quando ja existe uma sintese;
- smoke real `42361f0e-9ab1-4a1f-838e-10ac469e1c9c` confirmou a pausa em
  `evidence_ready` com 2 manifests, 3 chunks, zero AgentRuns e report `404`; o CTA
  abriu `?view=analysis` e iniciou as atividades reais dos especialistas;
- o mesmo smoke concluiu com 5 agentes, 6 chamadas auditadas (um retry), 8 findings
  e report final; repetir `POST /analysis` retornou `started=false` sem novo job;
- novas execucoes sobre o mesmo snapshot deslocam o numero das tentativas por
  agente, preservando audits anteriores em vez de sobrescreve-los.

Arquivos-chave:

- `src/investigation/application/run-investigation.ts`;
- `src/investigation/application/run-investigation-analysis.ts`;
- `src/investigation/adapters/postgres-investigation-analysis.ts`;
- `src/investigation/adapters/postgres-investigation-job.ts`;
- `src/database/migrations/013_investigation_analysis_stage.sql`;
- `ui/src/components/InvestigationWorkspace.tsx`;
- `ui/src/pages/InvestigationPage.tsx`;
- `src/api/routes/investigations.ts`.

Pendencias:

- perguntas continuam sendo persistidas na timeline para um proximo pass; ainda
  nao criam automaticamente um novo AgentRun;
- Hypothesis continua projetada do report/Experiment e ainda nao e um agregado
  proprio da investigation.

Validacoes:

- [x] migration 013 aplicada no PostgreSQL do Compose;
- [x] smoke HTTP confirmou `evidence_ready`, `/evidence` disponivel,
  `/ai-runs` vazio e `/report` indisponivel antes do CTA;
- [x] clique real no CTA via Chromium iniciou o job e navegou para a etapa 2;
- [x] navegacao ida/volta confirmou que Stream data nao mostra agentes,
  hipoteses ou Experiments e que Agent analysis restaura todos eles;
- [x] screenshots headless confirmaram as duas composicoes desktop e o report;
- [x] `npm run check`;
- [x] `npm test` - 41 arquivos, 190 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`;
- [x] rebuild Docker de API, worker e web; API/PostgreSQL saudaveis.

Proximo passo recomendado:

- persistir Hypothesis no caso e permitir que uma pergunta solicite um AgentRun
  explicito sobre uma revisao de evidencia.

### 2026-08-14 - Investigation Workspace claro e leve

Fases impactadas: Workspace e UX Investigate.

Entrega:

- o wrapper principal do workspace agora e uma superficie clara e continua sobre
  o shell escuro, seguindo o tom visual do `vhsdesign`;
- agentes, explorer, timeline e hipoteses usam fundo cinza muito suave, cards
  brancos, texto grafite e acentos violeta, azul, amber e mint;
- ladders, chunks selecionados, lanes, GOPs e frames ganharam contraste proprio
  para fundo claro, sem alterar seus dados ou interacoes;
- o escopo da mudanca ficou restrito aos dois componentes do workspace, mantendo
  a pagina e Experiments atuais sem uma refatoracao visual ampla;
- os casos reais HLS `975ed1be-1fa5-46d3-8dce-f23fd88b4e87` e DASH
  `c69cd0ae-c64d-4cca-b743-4dd533336948` foram renderizados novamente no Chromium
  headless e confirmaram o layout claro com ladders e GOPs completos.

Arquivos-chave:

- `ui/src/components/InvestigationWorkspace.tsx`;
- `ui/src/components/DeterministicStreamExplorer.tsx`;
- `docs/ui/UI-GUIDE.md`.

Pendencias:

- o bloco Experiments ainda segue o visual escuro global e pode ser revisto em um
  corte proprio se passar a fazer parte da mesma folha de trabalho.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 40 arquivos, 187 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`;
- [x] rebuild Docker do web e smoke visual headless HLS/DASH;
- [x] API e PostgreSQL saudaveis; web, worker e lab ativos no Compose.

Proximo passo recomendado:

- persistir Hypothesis no caso e ligar sua acao ao plano de replay controlado.

### 2026-08-14 - Ladder, chunks e GOPs visuais

Fases impactadas: Workspace, evidencia deterministica, API e UX Investigate.

Entrega:

- o explorer segue a hierarquia do `vhsdesign`: root manifest e metricas, ladder
  por representation, chunks clicaveis na propria linha e inspector expandido;
- HLS e DASH usam a ladder declarada completa, enquanto a UI diferencia de forma
  explicita representations preservadas e nao amostradas;
- o inspector mostra lanes temporais, offset inicial A/V observado, GOPs
  selecionaveis e frames I/P/B ou random access com PTS/DTS/duracao;
- FFprobe agora projeta um resumo compacto de ate 24 GOPs e 360 frames por GOP,
  com contagens completas e truncamento explicito;
- o contrato de evidencia preserva `probe.boundary` e detalhes de codec ao ler o
  snapshot do PostgreSQL; antes esses campos eram descartados pelo Zod da API;
- o smoke real encontrou FFprobe emitindo `packets_and_frames`; o adapter agora
  normaliza esse formato e os arrays separados antes de construir os GOPs;
- o workspace continua simples como orquestrador e o explorer deterministico fica
  isolado em um componente dedicado;
- smoke HLS `975ed1be-1fa5-46d3-8dce-f23fd88b4e87`: 5 variants declaradas,
  3 chunks 1080p preservados, 600 frames por chunk e 2--3 GOPs com I/P/B;
- smoke DASH `c69cd0ae-c64d-4cca-b743-4dd533336948`: 6 video representations +
  audio, 18 chunks, 6 INITs, uma representation nao amostrada explicita e GOPs
  I/P com fallback fMP4/sync;
- screenshots headless de ambas as paginas confirmaram ladder, coverage, lanes,
  selecao de GOP e detalhe de frames no layout desktop.

Arquivos-chave:

- `ui/src/components/DeterministicStreamExplorer.tsx`;
- `ui/src/components/InvestigationWorkspace.tsx`;
- `src/investigation/adapters/ffprobe-media-probe.ts`;
- `src/investigation/ports/media-sample-collector.ts`;
- `src/contracts/investigation.ts`;
- `ui/src/lib/api.ts`.

Pendencias:

- snapshots antigos usam o fallback de frame/fMP4 boundary quando ainda nao
  possuem o mapa compacto;
- Hypothesis e test plan continuam no agregado Experiment.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 40 arquivos, 187 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`;
- [x] rebuild Docker de API, worker e web;
- [x] smoke API/snapshot e captura headless HLS/DASH;
- [x] worker restaurado com a configuracao normal de IA depois do smoke.

### 2026-08-14 - Primeiro corte do Investigation Workspace

Fases impactadas: Workspace, API e UX Investigate.

Entrega:

- a tela de investigation foi reorganizada como workspace de tres colunas:
  agentes/prompts, explorer de manifestos e chunks, e hipoteses;
- o inspector usa somente facts preservados: tracks, PTS/DTS, contagem de frames,
  boundary frames e fMP4/GOP quando a coleta os produziu;
- perguntas do usuario agora sao atividades persistidas em `investigation_events`;
  elas nao disparam uma chamada de IA implicitamente;
- Experiments permanece como caminho real para URL estavel, replay controlado e
  feedback ao caso.

Arquivos-chave:

- `ui/src/components/InvestigationWorkspace.tsx`;
- `ui/src/pages/InvestigationPage.tsx`;
- `src/investigation/adapters/postgres-investigation-questions.ts`;
- `src/api/routes/investigations.ts`.

Pendencias:

- Hypothesis ainda pertence ao Experiment e e o proximo refactor deliberado.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 39 arquivos, 184 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`.

### 2026-08-14 - Snapshots e AgentRun fora do report

Fases impactadas: Workspace, worker e persistencia Investigate.

Entrega:

- migration 012 cria `evidence_snapshots` imutaveis por investigation e
  `agent_runs` com prompt, ferramentas e output validado;
- a publicacao de artifacts cria o snapshot na mesma transacao; o explorer le o
  snapshot mais recente, sem procurar metadata em um artifact arbitrario;
- o worker persiste cada tentativa de agente contra o snapshot usado;
- o report permanece uma projecao compartilhavel e nao duplica prompt audits.
- corrigida a compatibilidade do build web ES2020: o selector de auditoria usa
  indexacao comum, sem `Array.prototype.at`.

Pendencias:

- Hypothesis e test plan ainda pertencem ao agregado Experiment; o proximo corte
  deve movê-los para a investigation sem criar um segundo fluxo de UI.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 39 arquivos, 184 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check` pendente da revisão final desta fatia.

### 2026-08-11 - Isolamento entre tentativas concorrentes do Record DASH

Fases impactadas: Record R2, worker e Experiments.

Entrega:

- diagnosticado `EEXIST` no CONTROL como corrida local: um dos tres downloads
  concorrentes falhava, `Promise.all` retornava cedo, e siblings da tentativa
  antiga podiam gravar depois que o retry recriava o workspace;
- o fan-out DASH agora usa `allSettled` e somente propaga a falha quando nenhum
  worker antigo pode continuar escrevendo;
- init/chunk com erro tipado e retryable possui ate tres tentativas locais com
  evento `recording.resource_retry`, sem URL/token no payload;
- Record passa a ter timeout configuravel proprio, default 60s, sem ampliar o
  timeout de 25s da coleta Investigate;
- escrita exclusiva permanece ativa para detectar qualquer violacao de
  isolamento, em vez de sobrescrever bytes silenciosamente.

Arquivos-chave:

- `src/record/adapters/dash-vod-materializer.ts`;
- `src/record/adapters/dash-vod-materializer.test.ts`;
- `src/config.ts`;
- `src/worker/index.ts`;
- `compose.yml`;
- `docs/api.md`;
- `docs/architecture/DECISIONS.md`.

Validacoes:

- [x] testes direcionados DASH/recording worker - 10 testes;
- [x] `npm run check`;
- [x] `npm test` - 39 arquivos, 182 testes;
- [x] `npm run build`;
- [x] `git diff --check`;
- [x] `docker compose config --quiet`;
- [x] worker publicado com `recordRequestTimeoutMs=60000` e servicos saudaveis;
- [x] dois workspaces privados orfaos dos clones falhos removidos pelo contrato
  `RecordingStore`, sem recording publicado afetado;
- [x] novo Experiment limpo `9b065a0c-a308-4287-b7a4-f8e45675d4b7` criado com
  CONTROL em build e LOW-BR em fila; o Experiment falho permanece como historico;
- [x] smoke do worker novo completou os 30 chunks de `video-0` na primeira
  tentativa e avancou para `video-1`, sem `EEXIST` e com heartbeat ativo.

### 2026-08-11 - Recuperacao do primeiro plano DASH de Experiment

Fases impactadas: API e UX Investigate/Experiments.

Entrega:

- corrigido o round-trip de CloneSpec para IDs DASH reais com `=`, como
  `video_por=7094000`; o preview ja produzia esse ID, mas o endpoint de iteration
  o rejeitava e deixava o Experiment em `DRAFT`;
- IDs de representation continuam allowlisted e conferidos contra a evidencia
  deterministica; whitespace e payloads command-like permanecem rejeitados;
- erros de schema da iteration agora incluem paths/motivos seguros;
- Experiments `DRAFT` podem continuar com `CONTROL + LOW-BR`, e `PLANNED` pode
  reenfileirar a etapa ja salva sem criar outro Experiment;
- a UI nao anuncia clones em build quando ainda nao existe uma iteration;
- CONTROL e treatments aparecem como cards desde `QUEUED`, com estado,
  `What changed` e falha real, em vez de ficarem invisiveis ate o TestRequest.

Arquivos-chave:

- `src/contracts/experiment.ts`;
- `src/contracts/experiment.test.ts`;
- `src/experiment/application/clone-compiler.test.ts`;
- `src/api/routes/experiments.ts`;
- `src/api/experiments.test.ts`;
- `ui/src/components/InvestigationExperiments.tsx`.

Validacoes:

- [x] testes direcionados de contracts/compiler/API - 17 testes;
- [x] `npm run check`;
- [x] `npm test` - 39 arquivos, 179 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`;
- [x] imagens backend/web reconstruidas e API/web/worker saudaveis;
- [x] Experiment `f262ddfd-0718-4b63-bd69-3ed82d4e7742` recuperado sem
  duplicacao: iteration 1 persistida, CONTROL em build e LOW-BR em fila.

### 2026-08-11 - Timeout de media sample nao reinicia toda Investigation

Fases impactadas: 2, 3, Record R2 e UX Investigate.

Entrega:

- diagnostico em PostgreSQL confirmou retry limitado a tres tentativas, mas um
  unico segmento DASH lento descartava toda a coleta ja realizada;
- manifest raiz continua obrigatorio e retryable; erros tipados de init/media
  sample agora viram limitations por representation e preservam outras amostras;
- depois da primeira falha, a janela daquela representation e interrompida para
  evitar timeouts repetidos;
- progresso deixa de exibir valores incoerentes como `segment 277 of 3`: ordinal
  da amostra e numero do segmento de origem ficam separados;
- falha de init/chunk/repeat hash agora gera o evento persistido e visivel
  `investigation.collection_limited`, com tipo do recurso, representation ou
  logical key, segmento de origem e error code, sem incluir a URL assinada;
- falhas de manifest continuam seguindo o retry limitado e agora identificam na
  mensagem se a fronteira foi root manifest, variant HLS ou audio rendition; a
  falha terminal mostra a ultima causa em vez de uma mensagem generica.

Arquivos-chave:

- `src/investigation/adapters/http-media-sample-collector.ts`;
- `src/investigation/adapters/http-manifest-collector.ts`;
- `src/investigation/application/run-investigation.ts`;
- `src/investigation/adapters/postgres-investigation-job.ts`;
- `src/investigation/ports/manifest-collector.ts`;
- `ui/src/components/InvestigationFeed.tsx`;
- `docs/api.md`;
- `docs/ui/UI-GUIDE.md`.

Validacoes:

- [x] testes direcionados de collectors/application - 24 testes;
- [x] `npm run check`;
- [x] `npm test` - 39 arquivos, 178 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - avisos conhecidos do dash.js e chunks;
- [x] `git diff --check`;
- [x] `docker compose build worker` e `docker compose build web`;
- [x] API/PostgreSQL saudaveis, worker iniciado com a nova imagem e web HTTP 200.

### 2026-08-11 - Build limpo da UI de Experiments

Fase impactada: UX Investigate e build/deploy.

Entrega:

- removido o uso de `Array.prototype.at` da UI de Experiments, preservando o
  target/lib ES2020 atual em vez de ampliar o requisito de runtime;
- o build Docker limpo deixa de divergir do build incremental local.

Validacoes:

- [x] `npm exec tsc -- -b --force` em `ui/`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `docker compose build web`.

### 2026-08-11 - Closed-loop Experiment com URL unica por device

Fases impactadas: 2, 3, Record R1/R2, API, worker, persistencia e UX Investigate.

Entrega:

- migration 011 e dominio para Experiment, Hypothesis, Iteration, CloneSpec v1,
  clone experimental, TestEnvironment, TestRequest/TestResult e Evaluation;
- application service compartilhado pelas rotas REST e UI, sem MCP/framework
  novo e sem mover logica de negocio para componentes;
- CloneCompiler gera planos declarativos, sem shell, e recusa modos/recipes que o
  materializador atual nao executa ou que nao diferem de CONTROL;
- Record legado permanece intacto; recordings experimentais carregam spec/plano
  opcionais e o mesmo worker aplica selecao HLS/DASH;
- observer pos-clone reanalisa o manifest local, confere a selecao, persiste
  artifacts/provenance e impede clone experimental invalido de virar `READY`;
- URL fixa por Experiment com selecao transacional de TestRequest. CONTROL e
  treatments diferentes sao entregues no mesmo path configurado no device;
- UI integrada ao caso para criar o primeiro conjunto, acompanhar jobs, copiar a
  URL unica, selecionar tratamento, registrar outcome/stage/notes, avaliar e
  criar follow-up focado;
- evaluator deterministico fortalece/enfraquece hipoteses por CONTROL/treatments,
  preserva `NOT_REPORTED` e nunca inventa resultado de device.

Arquivos-chave:

- `src/database/migrations/011_experiments.sql` e `src/experiment/`;
- `src/record/application/run-recording.ts` e materializadores HLS/DASH;
- `src/api/routes/experiments.ts`, `src/api/routes/streams.ts` e composicao;
- `ui/src/components/InvestigationExperiments.tsx` e `ui/src/lib/api.ts`;
- `docs/api.md`, arquitetura, decisions e UI guide.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 39 arquivos, 176 testes;
- [x] `npm run build`;
- [x] testes direcionados de domain/compiler/verification/evaluation/API/data
  plane/worker/materializadores;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - sucesso; permanecem apenas os avisos ja
  conhecidos de bundle grande e CommonJS do `dash.js`;
- [x] migration 011 aplicada localmente com `npm run db:migrate`.

Pendencias intencionais:

- transcode, repackage/remux, HLS fMP4, live proxy e transformacao DRM;
- rerun completo de todo o pipeline Investigation contra output (o slice usa os
  mesmos parsers deterministicos e `recorded_resources`, sem nova investigation);
- MCP/skill/auth novo; REST e o modelo de workspace atual sao suficientes;
- smoke em device fisico e QR code.

### 2026-08-11 - Playback Record no browser e data plane completo

Fases impactadas: Record R1/R2, API, delivery e UX Record.

Entrega:

- o data plane agora implementa `GET`, `HEAD` e `OPTIONS` explicitamente;
  preflight aceita `Range`, expoe headers de tamanho/range e preserva CORS tambem
  em respostas de erro;
- ranges simples, abertos e por sufixo retornam `206`; range multiplo,
  malformado ou fora do recurso retorna `416 INVALID_PLAYBACK_RANGE` com o total;
- `HEAD` e `OPTIONS` nao consultam o run aberto, nao consomem o token bucket e
  nao entram no journal; somente GET representa delivery e ranges persistem os
  bytes/status efetivamente servidos;
- o Vite encaminha `/streams` para a API como o Nginx do Compose, eliminando o
  fallback HTML durante desenvolvimento local;
- a tela Record ganhou player explícito e controlado pelo usuario: hls.js para
  HLS e dash.js carregado sob demanda para DASH;
- antes de inicializar dash.js, a UI le o MPD local e verifica cada codec de
  video/audio via MSE. Video rejeitado fica `Unsupported` e nao baixa segmentos;
  playback iniciado participa normalmente do shaping e do journal do run ativo;
- a UI diferencia checking, ready, playing, buffering, unsupported e error e
  mantem explicita a limitacao entre MSE aceito, decode e frames renderizados.

Arquivos-chave:

- `src/api/routes/streams.ts` e `src/api/server.test.ts`;
- `ui/src/components/RecordingBrowserPlayer.tsx`;
- `ui/src/pages/RecordPage.tsx` e `ui/vite.config.ts`;
- `ui/package.json` e `ui/package-lock.json`;
- `docs/api.md`, `docs/ui/UI-GUIDE.md` e
  `docs/architecture/phases/phase-record-dash-vod.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 32 arquivos, 147 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - sucesso; dash.js em chunk sob demanda, com
  avisos de bundle acima de 500 kB e `COMMONJS_VARIABLE_IN_ESM` da distribuicao
  oficial do pacote;
- [x] Chromium headless carregou o chunk produzido, criou `MediaPlayer` e expoe
  `initialize`/eventos do dash.js sem erro de runtime;
- [x] `docker compose build api web` - imagens locais reconstruidas sem reiniciar
  o run ativo;
- [x] rota de stream: GET/CORS, preflight 204, HEAD sem lookup do run, range
  normal/sufixo, 206, 416 e CORS em 404/416;
- [x] `git diff --check`;
- [!] `npm audit --omit=dev` - duas vulnerabilidades moderadas existentes na
  UI, na cadeia `react-router`; fora desta entrega. O audit completo tambem
  sinaliza `nanoid` e `postcss` de tooling. O backend sinaliza uma vulnerabilidade
  alta em `fast-uri` transitivo, com fix disponivel.

Pendencias:

- reconstruir API/web do Compose depois do run ativo atual e executar smoke
  visual `Start normal` com HLS/AVC e DASH/HEVC em browsers com capacidades
  distintas;
- avaliar a atualizacao separada de React Router e tooling indicada pelo audit.

### 2026-08-11 - URL de playback fixa por recording

Fases impactadas: Record R1/R2, API, UX Record e deploy.

Entrega:

- O data plane passa a servir `/streams/recordings/:recordingId/*`, uma URL fixa
  por recording. Iniciar ou encerrar um playback run nunca muda a URL que o
  device ja tem.
- Cada request resolve o run aberto atual (`findLatestOpen`) para aplicar o
  perfil de rede e atribuir o journal; sem run ativo o clone e servido com o
  perfil baseline e sem journal.
- `SignedPlaybackUrl`, `VIDEO_HARNESS_PLAYBACK_SIGNING_SECRET`, o stop marker no
  filesystem e `isPlaybackRunStopped` foram removidos; `POST .../finish` apenas
  finaliza o run no banco e o botao de parada virou `Stop test run`.
- A UI deriva a URL fixa do recording e a exibe sempre que o recording esta
  pronto; o texto deixa explicito que a URL nao muda e que shaping vale somente
  durante um run ativo.
- A migration `010_remove_playback_token_hash.sql` permanece (o hash legado ja
  nao existe e nao voltara a ser consultado).

Arquivos-chave:

- `src/api/routes/streams.ts`;
- `src/api/routes/recordings.ts`;
- `src/record/application/playback-runs.ts`;
- `src/record/adapters/filesystem-recording-store.ts`;
- `ui/src/pages/RecordPage.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 32 arquivos, 147 testes;
- [x] `npm --prefix ui run check`;
- [x] testes de rota: URL fixa serve com run ativo e sem run; 404 para path
  desconhecido e traversal; 400 para recordingId invalido.

Pendencia:

- Smoke real em device externo: manter a mesma URL aberta no player enquanto se
  inicia/para runs no dashboard e confirmar que a URL nao muda e que o shaping
  segue o run ativo.

### 2026-08-09 - Reconfiguracao esperada deixa de ser falso risco ABR

Fases impactadas: 2, 3, Record R2 e semantica do report.

Entrega:

- corrigido `ABR_INIT_001`, que tratava mais de uma mudanca em parameter sets
  como risco `HIGH`; largura, altura e HEVC level esperados em 4K↔1080p eram
  suficientes para o falso positivo;
- agora somente diferencas explicitamente `RISKY_DECODER_RECONFIGURATION`
  acionam a regra;
- prompts do ABR Quality Investigator e Lead proíbem usar mudanca esperada de
  resolucao/level/INIT/SPS como causa ou recomendar ladder de resolucao fixa sem
  contrato incompatível, decode falhando, capability mismatch ou falha observada;
- regressao cobre multiplas mudancas SPS esperadas sem finding e sem risco.

Arquivos-chave:

- `src/abr/application/rules.ts`;
- `src/abr/application/rules.test.ts`;
- `src/agents/domain/prompts.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 33 arquivos, 150 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - sucesso, com aviso conhecido de chunk acima
  de 500 kB;
- [x] `git diff --check`;
- [x] `docker compose up -d --build worker` - API healthy e worker reiniciado com
  a regra/prompt novos.

Pendencia:

- repetir a URL em uma nova investigation; o report anterior preserva a regra e
  a sintese historicas.

### 2026-08-09 - Fan-out limitado corrige falhas simultaneas do provider

Fase impactada: 3 e runtime da equipe de IA.

Entrega:

- diagnostico do smoke `5a525992-5508-4219-b1e2-d1a16d6912f8`: quatro
  especialistas iniciavam juntos; Mara e o ABR Quality Investigator falharam em
  paralelo nas duas tentativas, enquanto Pip, Coda e depois o Lead concluiram;
- fan-out dos especialistas limitado a duas chamadas simultaneas, preservando
  paralelismo sem exceder a capacidade observada do provider;
- retry agora espera um segundo antes da segunda tentativa;
- erro do SDK passa por classificacao/redacao segura para rate limit, 5xx,
  contexto, autenticacao ou transporte, sem persistir resposta bruta;
- regressao mede a concorrencia maxima e mantem os cinco lifecycle runs reais.

Arquivos-chave:

- `src/agents/application/run-agent-team.ts`;
- `src/agents/adapters/pi-model-runner.ts`;
- `src/agents/domain/errors.ts`;
- `src/investigation/adapters/pi-investigation-ai.test.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 33 arquivos, 149 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - sucesso, com aviso conhecido de chunk acima
  de 500 kB;
- [x] `git diff --check`;
- [x] `docker compose up -d --build worker` - imagem reconstruida, API healthy e
  worker reiniciado com a configuracao de IA esperada.

Pendencia:

- repetir o smoke em uma nova investigation; investigations concluidas nao sao
  reexecutadas automaticamente.

### 2026-08-08 - AbrAssessment protocol-neutral e especialista sempre ativo

Fases impactadas: 2, 3, Record R2, API e UX Investigate.

Entrega:

- `AbrAssessment` virou a raiz do diagnostico ABR para HLS e DASH, com ladder
  canonica, cobertura, verdict, findings determinísticos, transicoes/matrix e
  medicoes recomendadas;
- regras gerais detectam ladder ausente, bandwidth faltante, progressao
  inconsistente, gaps, duplicacoes e mistura de familias de codec;
- o problema relatado prioriza direcao, resolucoes e horario sem limitar o
  baseline nem transformar texto em telemetria;
- a selecao DASH deixa de fixar 4K/Full HD e distribui a amostra pela ladder ou
  segue uma transicao explicitamente relatada;
- o ABR Quality Investigator roda em toda investigation, recebe ferramentas de
  inspecao preservada e distingue candidato estatico, selecao por request e
  decode/render nao medidos;
- a UI apresenta `ABR quality` em qualquer protocolo e mantem fallback para
  reports historicos;
- parsing de contexto relatado saiu de `stream-tools` e passou para application
  de Investigation; schemas backend/UI aceitam o formato atual e o legado.

Arquivos-chave:

- `src/abr/domain/assessment.ts`;
- `src/abr/application/assess-stream-abr.ts`;
- `src/agents/application/abr-quality-investigator-agent.ts`;
- `src/investigation/application/build-manifest-evidence.ts`;
- `src/investigation/application/parse-reported-context.ts`;
- `src/contracts/abr.ts` e `src/contracts/investigation.ts`;
- `ui/src/components/InvestigationReport.tsx` e `ui/src/lib/api.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 32 arquivos, 146 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - sucesso, com aviso conhecido de chunk acima
  de 500 kB;
- [x] `git diff --check`.

Pendencias:

- HLS avalia a ladder declarada inteira, mas ainda amostra media de uma variant;
  seguranca cross-variant permanece declarada como nao medida;
- o endpoint de Record continua expondo transicoes request-level; consolidar o
  comportamento observado de um run em `AbrAssessment` e follow-up;
- smoke com manifests reais e player/device externo.

Proximo passo recomendado:

- adicionar coleta alinhada de duas variants HLS para promover seguranca de
  transicao HLS de limitacao declarada para evidencia deterministica.

### 2026-08-08 - Coleta de media por tempo, bytes como seguranca

Fases impactadas: 2 e 3.

Entrega:

- O modo `full` passa a selecionar uma janela contigua de ate
  `VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS` (default 60s) por variant/representacao,
  centrada no horario de incidente relatado quando existir; sem horario, a janela
  parte do inicio da playlist. Antes, `full` baixava todos os segmentos ate o
  budget agregado, o que com 20 MiB cobria apenas ~1s de 4K ou ~9min de bitrate
  baixo.
- A selecao usa o tempo declarado no manifest: duracao cumulativa dos segmentos
  HLS (com fallback para `targetDuration`) e `presentationStart/EndSeconds` no
  DASH. Janela balanceada em torno do incidente via `contiguousWindow`.
- Limites de bytes sao agora redes de seguranca: `MAX_TOTAL_BYTES` default 20 MiB
  para 512 MiB e `MAX_BYTES` (por fetch) de 20 MiB para 128 MiB, evitando que um
  segmento gigante ou abuso de download derrube o worker.
- Novas envs e defaults em `src/config.ts`, `compose.yml`, `compose.prod.yml` e
  `.env.example`; worker repassa `maxSeconds` ao coletor.
- Limitation nova quando o horario relatado nao mapeia para a timeline HLS (sem
  duracoes declaradas); DASH alinha a janela ao budget de tempo mantendo a
  revalidacao de hashes do segmento incidente.

Arquivos-chave:

- `src/investigation/adapters/http-media-sample-collector.ts`
- `src/config.ts`
- `src/worker/index.ts`
- `src/investigation/adapters/http-media-sample-collector.test.ts`
- `src/config.test.ts`
- `compose.yml`, `compose.prod.yml`, `.env.example`
- `docs/architecture/README.md`, `docs/architecture/phases/phase-2.md`

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 140 testes;
- [ ] `npm run build` e validacao via UI/Compose - pendentes nesta tarefa.

Pendencias:

- Samples continuam segurados inteiros em memoria durante a coleta; streaming para
  disco fica como follow-up quando os budgets subirem mais.
- Smoke com um HLS VOD longo para confirmar a janela de 60s na UI.

Proximo passo recomendado:

- Rodar o build final e um smoke manual com VOD longo.

### 2026-08-08 - ABR switch first-class com entrada URL-only

Fases impactadas: 2, 3, Record R2, API e UX Investigate.

Entrega:

- `AbrSwitchEvidence` diferencia candidato estatico de transicao observada;
- parsers/diffs/timeline/rules deterministas cobrem MPD, INIT, HEVC e fragment;
- Investigate gera matriz e candidatos com apenas a URL e usa a descricao
  opcional como contexto relatado;
- o agente ABR roda condicionalmente sobre o candidato mais relevante, sem dump
  indiscriminado de packets/frames;
- Record expoe a correlacao request-level em `GET .../abr-switches`;
- fixtures A--K cobrem switch geral/bitstream valido, violações, gaps, skew,
  decoder reconfiguration risk e o gate estrito de `PLATFORM_SUSPECTED`.

Arquivos-chave:

- `src/abr/`;
- `src/stream-tools/dash-mpd.ts` e `src/stream-tools/isobmff.ts`;
- `src/investigation/application/build-manifest-evidence.ts`;
- `src/agents/application/abr-switch-investigator-agent.ts`;
- `src/record/application/build-abr-switch-evidence.ts`;
- `ui/src/components/InvestigationReport.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 136 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - sucesso, com aviso conhecido de chunk acima
  de 500 kB;
- [x] `git diff --check`.

Pendencias:

- smoke com MPD real e player externo;
- integrar o adapter opcional DASH-IF a uma instalacao real do validator;
- evidencia especifica de Samsung continua opcional; sem reproducao/device o
  resultado nao pode ser `PLATFORM_SUSPECTED`.

### 2026-08-08 - Auditoria de prompts e evidencia da equipe de IA

Fases impactadas: 3, API e UX Investigate.

Entrega:

- Cada chamada efetiva ao modelo (inclusive retry) preserva o system prompt, o
  pacote final de analise/evidencia, provider, modelo, ferramentas disponiveis
  e estado publico; raciocinio interno nao e armazenado.
- `GET /v1/investigations/:id/ai-runs` expoe a auditoria somente no workspace.
- O report abre o prompt e a evidencia por especialista, com progressive
  disclosure e tentativas separadas.

Arquivos-chave:

- `src/agents/application/run-agent-team.ts`;
- `src/agents/domain/types.ts`;
- `src/api/routes/investigations.ts`;
- `ui/src/components/InvestigationReport.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm --prefix ui run check`;
- [x] `npm test` - 106 testes;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- Nenhuma pendencia especifica desta entrega.

### 2026-08-08 - Dominio agents extraido do adapter Pi

Fases impactadas: 3.

Entrega:

- O core de agentes de IA saiu de `pi-investigation-ai.ts` para o dominio
  `src/agents/`: roster fixo (3 especialistas + Lead), prompts, parsing
  tolerante, classificacao de erros e orquestracao `runAgentTeam`.
- Novo port `AgentModelRunner` separa a equipe do provider LLM; o adapter Pi
  concentra `@earendil-works/pi-agent-core` e `@earendil-works/pi-ai`.
- `pi-investigation-ai.ts` ficou adeligado: continua implementando
  `InvestigationAI`, mas agora monta packet/tools/medicoes de sintoma e delega a
  execucao da equipe ao dominio.
- `InvestigationAI` reexporta os tipos compartilhados do dominio
  (`AiFinding`, `AiAgentRun`, `AiAgentProgress`, `AiInvestigationResult`); os
  demais modulos de investigation nao mudaram de import.

Arquivos-chave:

- `src/agents/domain/{types,profiles,prompts,parsing,errors}.ts`;
- `src/agents/ports/agent-model-runner.ts`;
- `src/agents/application/run-agent-team.ts`;
- `src/agents/adapters/pi-model-runner.ts`;
- `src/investigation/adapters/pi-investigation-ai.ts`;
- `src/investigation/ports/investigation-ai.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 105 testes;
- [x] `npm run build`;
- [x] `git diff --check`.

Pendencias:

- Nenhuma.

Proximo passo recomendado:

- Revisar se `unavailableResult` e o retry de 2 tentativas devem ganhar testes
  proprios no novo dominio.

### 2026-08-08 - Restauracao e parada de playback run

Fases impactadas: Record R1/R2, API e UX Record.

Entrega:

- `GET /v1/recordings/:id/playback-runs/latest` restaura o último run
  `created`/`active` e sua URL assinada após refresh.
- `POST .../finish` encerra o run e grava marcador persistente no storage;
  requests posteriores recebem `410 PLAYBACK_RUN_FINISHED` sem lookup no banco.
- A UI mostra `Stop streaming` durante o run e oferece novo teste somente depois
  de encerrá-lo.

Arquivos-chave:

- `src/api/routes/recordings.ts`;
- `src/record/adapters/postgres-playback-run.ts`;
- `src/record/adapters/filesystem-recording-store.ts`;
- `ui/src/pages/RecordPage.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 105 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`;
- [x] API local reconstruida; `GET .../playback-runs/latest` confirmou um run
  aberto e sua URL assinada.

Pendencias:

- Smoke manual: abrir a tela em outro navegador, atualizar e usar `Stop
  streaming` enquanto o device ainda solicita segmentos.

### 2026-08-07 - URLs de playback assinadas e sem lookup no data plane

Fases impactadas: Record R1/R2, API, UX Record e deploy.

Entrega:

- Cada playback run devolve uma URL propria em `/streams/:signedPlaybackToken/*`;
  o payload HMAC-SHA256 inclui run, recording, profile e expiracao de 24 horas.
- A migration `010_remove_playback_token_hash.sql` removeu o hash opaco legado:
  o token assinado tambem nao e salvo no banco.
- O data plane valida assinatura e expiracao em memoria e le apenas o arquivo
  publicado dentro do recording assinado, sem resolver run ou recurso no banco.
- O journal continua best-effort e assincrono, portanto nao atrasa a entrega.
- O alias global `/streams/fixed/*` foi removido; a UI copia a URL unica e deixa
  a validade de 24 horas explicita.
- A chave obrigatoria `VIDEO_HARNESS_PLAYBACK_SIGNING_SECRET` tem minimo de 32
  caracteres e esta documentada para Compose e deploy.
- API e worker recebem a mesma chave no Compose; sem ela o worker nao inicializa
  e recordings permanecem em `queued`.

Arquivos-chave:

- `src/record/application/signed-playback-url.ts`;
- `src/api/routes/streams.ts`;
- `src/record/adapters/filesystem-recording-store.ts`;
- `compose.yml`, `compose.prod.yml` e `.env.example`.

Validacoes:

- [x] `npm run check`;
- [x] testes direcionados de API, config e assinatura HMAC - 19 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- Definir `VIDEO_HARNESS_PLAYBACK_SIGNING_SECRET` com valor aleatorio estavel
  antes de subir Compose; trocar a chave invalida URLs ainda abertas.

### 2026-08-06 - Record DASH VOD estatico

Fases impactadas: Record R2, API e UI Record.

Entrega:

- O intake aceita `protocol: hls | dash`; HLS continua como default.
- O materializador DASH coleta MPD `static` clear com `SegmentTemplate`, init e
  segmentos de todas as representations da adaptation set de video (e um grupo
  de audio), reescrevendo um `index.mpd` local auto-contido.
- Playback runs de DASH retornam URL opaca terminada em `index.mpd`; o mesmo
  shaping e journal por resource sao reutilizados.
- Dynamic MPD, DRM, `SegmentBase` e byte ranges sao recusados antes de publish.

Arquivos-chave:

- `src/record/adapters/dash-vod-materializer.ts`;
- `src/record/adapters/recording-materializer.ts`;
- `src/worker/index.ts`;
- `src/contracts/recording.ts`;
- `ui/src/pages/RecordPage.tsx`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/record src/api/server.test.ts` - 23 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- Smoke com MPD real/player externo e inferencia ABR `observed/sustained`.

Proximo passo recomendado:

- Criar um recording DASH VOD e validar troca de representation no journal.

### 2026-08-06 - Limite de tamanho DASH sem retry

Fases impactadas: Record R2.

Entrega:

- Falhas de `StreamCollectionError` agora preservam codigo e retryability no
  worker; teto de bytes deixa de reenfileirar o mesmo recording.
- DASH estima os bytes da ladder antes de buscar init ou segmentos, evitando
  minutos de download quando a janela inteira nao cabe no teto de 1 GiB.

Arquivos-chave:

- `src/record/application/run-recording.ts`;
- `src/record/adapters/dash-vod-materializer.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/record` - 13 testes;
- [x] `git diff --check`.

Pendencias:

- Reconstruir o runtime local e repetir o recording com janela menor.

### 2026-08-06 - Exposicao LAN do data plane Record

Fases impactadas: Record R1/R2 e deploy local.

Entrega:

- A porta web (UI, `/v1` proxy e `/streams`) passa a escutar em `0.0.0.0:5173`
  por default, configuravel via `VIDEO_HARNESS_WEB_BIND_ADDRESS`.
- API e PostgreSQL continuam loopback-only; devices externos usam somente a
  origem web, que faz proxy interno para o data plane.

Arquivos-chave:

- `compose.yml`;
- `ui/nginx.conf`;
- `docs/ui/UI-GUIDE.md`.

Validacoes:

- [ ] Recriar `web` e confirmar acesso de outra maquina na LAN.

Pendencias:

- Liberar a porta 5173 no firewall do host, se houver um configurado.

### 2026-08-06 - Alias fixo de playback

Fases impactadas: Record R1/R2 e API.

Entrega:

- `POST /playback-runs` agora devolve `/streams/fixed/index.m3u8` ou
  `/streams/fixed/index.mpd`, sem token na URL entregue ao device.
- O alias resolve o playback run `created`/`active` mais recente ainda valido;
  o token opaco interno continua suportado para isolamento e compatibilidade.

Arquivos-chave:

- `src/api/routes/streams.ts`;
- `src/record/adapters/postgres-playback-run.ts`.

Validacoes:

- [x] API reconstruida e healthcheck PostgreSQL/API passou.
- [x] origem web acessivel pela LAN em `http://192.168.0.114:5173`.
- [x] teste de rota fixa em Fastify (`/streams/fixed/index.m3u8`).
- [ ] Testar alias fixo em player externo apos criar um novo playback run.

### 2026-08-06 - Modos normal e Force ABR

Fases impactadas: Record R1/R2 e UI Record.

Entrega:

- A tela de recording pronto oferece `Start normal` e `Force ABR`.
- O modo normal envia um profile auditavel de 100.000 Kbps/0 ms; Force ABR
  preserva o profile Good -> constrained -> recovery já existente.
- O painel passa a identificar o modo do run criado e explica se houve ou não
  pressão intencional de rede.

Arquivos-chave:

- `ui/src/lib/api.ts`;
- `ui/src/pages/RecordPage.tsx`.

Validacoes:

- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `npm run check`;
- [x] `git diff --check`.

### 2026-08-06 - Controle DASH 1080p sem ABR

Fases impactadas: Record R2 e data plane.

Entrega:

- `GET /streams/fixed-1080/index.mpd` deriva um MPD local com a representation
  1920x1080 de maior bitrate e o audio original; não há outra representation de
  video para uma troca ABR.
- O controle reutiliza somente bytes registrados do recording e mantém o mesmo
  journal de delivery e profile do run atual.
- A UI DASH oferece `1080p control`; ao escolher esse modo, a URL fixa normal
  (`/streams/fixed/index.mpd`) passa a servir o MPD reduzido para aquele run.

Arquivos-chave:

- `src/api/routes/streams.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/api/server.test.ts` - 12 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

## Registro de atualizacoes

### 2026-08-08 - Progresso real de coleta na linha Investigate

Fases impactadas: 2, 4, API e UX Investigate.

Entrega:

- O worker passou a transicionar explicitamente para `collecting` logo apos
  `validating` e a publicar uma observacao `stage: "collection"` por etapa real de
  coleta, em vez de permanecer mudo no estado `validating`.
- Etapas: `root_manifest`, `variant_manifest`, `rendition_manifest`,
  `media_sample` (um evento por segmento/init, com `completed`/`total` contados do
  manifest) e `media_probe` (um por amostra antes do FFprobe).
- Ports `ManifestCollector` e `MediaSampleCollector` aceitam `onProgress`
  opcional; falha do callback nao derruba a coleta.
- A UI mostra um card vivo durante `collecting` com o passo atual, contador/barra
  reais e chips das etapas concluidas; eventos de coleta ficam persistidos
  (auditaveis via API) mas nao viram posts individuais na timeline.

Arquivos-chave:

- `src/investigation/ports/manifest-collector.ts`;
- `src/investigation/ports/media-sample-collector.ts`;
- `src/investigation/adapters/http-manifest-collector.ts`;
- `src/investigation/adapters/http-media-sample-collector.ts`;
- `src/investigation/application/run-investigation.ts`;
- `ui/src/components/InvestigationFeed.tsx`;
- `docs/api.md`;
- `docs/ui/UI-GUIDE.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 109 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [ ] `git diff --check`.

Pendencias:

- Smoke manual com uma origin HLS real para confirmar a sequencia de eventos
  `collection` e o card vivo na tela do caso.

Proximo passo recomendado:

- Validar o smoke e avaliar se a granularidade por segmento deve ser limitada em
  streams muito longas.

### 2026-08-07 - Workflow de push para GHCR

Fases impactadas: 5.

Entrega:

- `.github/workflows/docker-image.yml` passou a construir e publicar as imagens
  `ghcr.io/gugaio/videoharness/backend` e `.../web` com Buildx e cache GitHub.
- Tags: `sha-<short>`, nome da branch, `vX.Y.Z`/`vX.Y` em tags semanticas e
  `latest` em `main`; PRs constroem sem push.
- Backend usa `Dockerfile` raiz; web usa `ui/Dockerfile`.

Arquivos-chave:

- `.github/workflows/docker-image.yml`.

Validacoes:

- [x] YAML valido (`js-yaml`).

Pendencias:

- Primeiro push depende de `GITHUB_TOKEN` ja conceder `packages: write`; nenhuma
  imagem ainda foi publicada.

Proximo passo recomendado:

- Abrir um PR e confirmar o build das duas imagens no GHCR.

### 2026-08-07 - Deploy via Coolify com compose de producao

Fases impactadas: 5.

Entrega:

- `compose.prod.yml` para deploy em Coolify (ou qualquer runtime docker compose),
  referenciando as imagens GHCR ja publicadas pelo CI em vez de build contexts.
- `pull_policy: always` em api, worker, lab e web para que todo redeploy puxe a
  imagem `:latest` sem cache local.
- Sem ports de host: somente `web` e publico via dominio do proxy; postgres, api
  e worker ficam privados na rede interna do stack.
- Segredos exigidos com `${VAR:?}` (`VIDEO_HARNESS_POSTGRES_PASSWORD`,
  `VIDEO_HARNESS_LAB_TOKEN`, `VIDEO_HARNESS_AI_API_KEY`) para validacao na UI do
  Coolify.
- Job `deploy` no `docker-image.yml` chama o webhook Git Deploy do Coolify
  (`COOLIFY_WEBHOOK_URL`) somente depois que as imagens foram publicadas,
  eliminando a corrida entre push e build da CI.

Arquivos-chave:

- `compose.prod.yml`
- `.github/workflows/docker-image.yml`
- `docs/development/DEVELOPMENT-GUIDE.md` (secao "Deploy com Coolify")

Validacoes:

- [x] `docker compose -f compose.prod.yml config --quiet` com as variaveis
      obrigatorias preenchidas.
- [x] YAML do workflow valido.

Pendencias:

- Configurar o recurso Docker Compose no Coolify, atribuir dominio ao `web`,
  preencher as variaveis obrigatorias e salvar `COOLIFY_WEBHOOK_URL` como secret
  no GitHub.

Proximo passo recomendado:

- Criar o recurso no Coolify e validar o primeiro deploy ponta a ponta.

### 2026-08-08 - Imagens multi-arquitetura para deploy em ARM

Fases impactadas: 5.

Entrega:

- `docker-image.yml` agora publica as imagens GHCR para `linux/amd64` e
  `linux/arm64` (`PLATFORMS` no env + `platforms:` no build-push-action),
  corrigindo o deploy em servidor Coolify arm64 que falhava com
  "no matching manifest for linux/arm64/v8".

Arquivos-chave:

- `.github/workflows/docker-image.yml`

Validacoes:

- [x] YAML do workflow valido.

Pendencias:

- Rebuild das imagens no GHCR (novo push ou redeploy manual) antes de subir o
  stack no servidor arm64.

Proximo passo recomendado:

- Confirmar o deploy do stack no Coolify arm64.

### 2026-08-08 - Limites do lab ajustados para VPS de 1 CPU

Fases impactadas: 5.

Entrega:

- `compose.prod.yml` passa a usar `VIDEO_HARNESS_LAB_CPUS` (default 1) e
  `VIDEO_HARNESS_LAB_MEM` (default 1g) no servico `lab`, corrigindo o erro do
  Docker "range of CPUs is from 0.01 to 1.00" no deploy do Coolify.

Arquivos-chave:

- `compose.prod.yml`

Validacoes:

- [x] `docker compose -f compose.prod.yml config --quiet` e valores interpolados
      conferidos (mem 1g, cpus 1).

Pendencias:

- Confirmar o primeiro deploy completo do stack no Coolify.

Proximo passo recomendado:

- Validar ponta a ponta o stack no servidor arm64.

### 2026-08-08 - Fallback de idempotency key no frontend

Fases impactadas: 4.

Entrega:

- `ui/src/lib/api.ts` usa `newIdempotencyKey()`: `crypto.randomUUID()` quando
  disponivel, com fallback para UUID v4 via `crypto.getRandomValues`. Corrige o
  erro "crypto.randomUUID is not a function" em paginas servidas por HTTP (o
  `randomUUID` do browser exige contexto seguro).

Arquivos-chave:

- `ui/src/lib/api.ts`

Validacoes:

- [x] `npm --prefix ui run check`.
- [x] `npm --prefix ui run build`.

Pendencias:

- Ativar HTTPS no dominio do Coolify (contexto seguro) para tambem beneficiar
  cookies/SSE em producao.

Proximo passo recomendado:

- Confirmar o acesso via HTTPS no domínio.

### 2026-08-05 - Plano Record HLS VOD e simulacao ABR

Fases impactadas: Record R1, Record R2, 4 e 5.

Entrega:

- Record passou a integrar a validacao atual do produto, sem depender do playback
  browser existente.
- HLS VOD clear/MPEG-TS foi definido como primeiro corte; DASH VOD ficou ordenado
  depois do Definition of Done de R1.
- Recording imutavel foi separado de PlaybackRun, permitindo repetir profiles
  sobre os mesmos bytes.
- Profile v1 usa stages deterministas por quantidade de requests de video,
  throughput compartilhado e latencia por request.
- Request journal distingue troca observada, sustentada, ausente e inconclusiva,
  sem alegar decode/render.
- Contratos planejados, UX, arquitetura, import do VHS, slices, riscos e DoD foram
  documentados.

Arquivos-chave:

- `AGENTS.md`;
- `docs/planning/RECORD-ABR-IMPLEMENTATION-PLAN.md`;
- `docs/architecture/phases/phase-record-hls-vod.md`;
- `docs/architecture/phases/phase-record-dash-vod.md`;
- `docs/api.md`;
- `docs/ui/UI-GUIDE.md`.

Validacoes:

- [ ] `npm run check` - nao necessario para mudanca somente documental;
- [ ] `npm test` - nao necessario para mudanca somente documental;
- [ ] `npm --prefix ui run check` - nao necessario para mudanca somente documental;
- [ ] `npm --prefix ui run build` - nao necessario para mudanca somente documental;
- [x] `git diff --check`.

Pendencias:

- Nenhum codigo, migration ou endpoint Record foi implementado ainda.
- Reavaliar budgets somente com metricas dos primeiros fixtures e smokes; os
  defaults/hard caps iniciais ja estao registrados no plano.

Proximo passo recomendado:

- Implementar o Slice 1 persistente descrito no plano Record.

### 2026-08-05 - Fundacao persistente de Record R1

Fases impactadas: Record R1.

Entrega:

- Adicionadas as tabelas `recordings`, `recording_jobs`, `recording_events` e
  `recorded_resources` na migration 006.
- Recording HLS possui contrato Zod, intake idempotente por assinatura, consulta
  persistida e timeline SSE com replay por `Last-Event-ID`.
- Worker generico de Record usa claim concorrente, lease/heartbeat, retry e
  estados reais `queued -> validating -> collecting -> ready`.
- O storage cria workspace isolado por UUID e so publica apos rename atomico;
  falha apos publicacao remove o destino antes de reagendar.
- As rotas Record sao opt-in na API. A composicao de producao permanece sem
  `startRecording` ate existir materializador HLS, impedindo jobs inviaveis.

Arquivos-chave:

- `src/database/migrations/006_recordings.sql`;
- `src/record/`;
- `src/api/routes/recordings.ts`;
- `src/api/server.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/record src/api/server.test.ts` - 13 testes;
- [x] `npm test` - 89 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- Nenhum materializador HLS foi conectado ainda; portanto nao ha endpoint Record
  publico ativo, URL local de playback, clone de segmentos ou simulacao ABR.

Proximo passo recomendado:

- Implementar o Slice 2 e conectar a composicao somente apos o clone HLS VOD
  conseguir produzir um recording auto-contido.

### 2026-08-06 - Clone HLS VOD auto-contido de Record R1

Fases impactadas: Record R1.

Entrega:

- `HlsVodMaterializer` clona master HLS VOD clear/MPEG-TS com duas a oito
  variants fetchable e renditions de audio vinculadas.
- A janela solicitada e reconstruida em playlists locais; segmentos, manifests,
  hash, content type, tamanho e metadados de timeline entram em
  `recorded_resources` na mesma transacao que marca o recording como `ready`.
- O clone usa `SafeHttpClient` em todos os manifests e chunks, preservando SSRF,
  redirect, timeout, limite de 64 MiB por resposta e 1 GiB agregado.
- Live, criptografia, fMP4/`EXT-X-MAP` e byte ranges sao recusados antes de
  qualquer publish. Falha remove o staging ou a publicacao parcial.
- API e worker passaram a compor Record de producao; `POST /v1/recordings` agora
  cria jobs executaveis.

Arquivos-chave:

- `src/record/adapters/hls-vod-materializer.ts`;
- `src/record/adapters/postgres-recording-job.ts`;
- `src/worker/index.ts`;
- `src/api/index.ts`;
- `src/config.ts`;
- `src/record/README.md`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 93 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- O data plane ainda nao serve os recursos locais e nao existe playback token,
  network profile, pacing ou journal ABR.
- Subtitles nao fazem parte do primeiro clone, embora audio vinculado seja
  preservado.

Proximo passo recomendado:

- Implementar o Slice 3: criar playback run/token e servir somente
  `recorded_resources` pelo data plane, sem origin fetch.

### 2026-08-06 - Data plane local com token opaco de Record R1

Fases impactadas: Record R1.

Entrega:

- Migration 007 cria `playback_runs`; tokens tem 256 bits e somente o hash
  SHA-256 e persistido.
- Um recording `ready` pode criar um playback run e receber a URL local
  `/streams/<token>/index.m3u8`.
- O data plane valida o caminho, resolve token + logical path no PostgreSQL e
  le apenas o `storage_key` registrado, sem URL ou fetch da origem.
- O primeiro segmento de video ancora o prazo configurado do run; antes dele ha
  uma janela limitada de inicializacao. Run vencido retorna `410`.

Arquivos-chave:

- `src/database/migrations/007_playback_runs.sql`;
- `src/record/adapters/postgres-playback-run.ts`;
- `src/api/routes/streams.ts`;
- `src/api/routes/recordings.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/api/server.test.ts src/record` - 19 testes;
- [x] `npm test` - 95 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- Ainda nao ha profile, pacing, Range/HEAD/OPTIONS, journal de requests ou
  inferencia ABR.

Proximo passo recomendado:

- Implementar o Slice 4: shaping compartilhado com backpressure e latencia por
  stage, mantendo o mesmo token e data plane.

### 2026-08-06 - Shaping reproduzivel por PlaybackRun

Fases impactadas: Record R1.

Entrega:

- Migration 008 persiste o profile v1 no playback run; entrada valida stages
  ordenados, bandwidth de 128--100.000 Kbps e latencia de 0--5.000 ms.
- O data plane aplica latencia a cada response e emite mídia em blocos de 16 KiB
  sob token bucket compartilhado por run; manifests nao consomem throughput.
- Stages sao decididos pela quantidade de requests de video anteriores, logo um
  trigger em 3 passa a vigorar no quarto request de video.
- Antes do journal do Slice 5, esse contador vive apenas no processo da API e
  nao sobrevive a reinicio; a limitacao esta exposta no contrato.

Arquivos-chave:

- `src/database/migrations/008_playback_profiles.sql`;
- `src/record/application/network-shaper.ts`;
- `src/contracts/recording.ts`;
- `src/api/routes/streams.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/record src/api/server.test.ts` - 21 testes;
- [x] `npm test` - 97 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- Journal persistido, request facts, Range/HEAD/OPTIONS e inferencia ABR ainda
  nao foram implementados.

Proximo passo recomendado:

- Implementar o Slice 5: persistir requests e derivar switches observados e
  sustentados a partir de variants requisitadas.

### 2026-08-06 - UX Record habilitada

Fases impactadas: Record R1 e 4.

Entrega:

- O card Record deixou de exibir `Coming soon`: agora abre `/record`.
- Intake dedicado envia HLS VOD, duracao da janela e navega imediatamente para
  `/recordings/:id`.
- A pagina da gravacao consome SSE persistido, mostra estado/cobertura/bytes e,
  quando pronta, cria o preset ABR e copia a URL opaca para o device.

Arquivos-chave:

- `ui/src/pages/HomePage.tsx`;
- `ui/src/pages/RecordPage.tsx`;
- `ui/src/App.tsx`;
- `ui/src/lib/api.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build` - aviso conhecido de bundle acima de 500 kB;
- [x] `git diff --check`.

Pendencias:

- O UI ainda aguardara journal e resultado ABR para mostrar requests e switches
  reais; nao exibe sucesso de ABR antecipadamente.

Proximo passo recomendado:

- Implementar o Slice 5 de journal e inferencia ABR, depois enriquecer a mesma
  tela com a evidencia persistida.

### 2026-08-06 - Progresso real do clone Record

Fases impactadas: Record R1 e 4.

Entrega:

- O materializador baixa os chunks de cada playlist com concorrencia limitada a
  tres, em vez de processa-los estritamente em serie.
- Eventos persistidos `recording.variant_started` e
  `recording.variant_completed` tornam o trabalho de coleta visivel na tela.
- O worker foi recomposto; recording jobs com lease interrompido sao retomados
  pela politica existente de retry/lease.

Arquivos-chave:

- `src/record/adapters/hls-vod-materializer.ts`;
- `src/record/application/run-recording.ts`;
- `src/record/ports/recording-materializer.ts`.

Validacoes:

- [x] `npm run check`;
- [x] `npm test -- --run src/record` - 9 testes;
- [x] `docker compose` recomposto com API, worker e web saudaveis;
- [ ] suite completa e build final - pendentes apos a correcao operacional.

Pendencias:

- O clone ainda registra progresso por playlist; o journal detalhado por request
  sera introduzido no Slice 5.

### 2026-08-06 - Proxy publico do data plane

Fases impactadas: Record R1 e 5.

Entrega:

- Nginx da web encaminha `/streams/*` para Fastify sem buffering, request
  buffering ou timeout curto, em vez de aplicar o fallback da SPA.
- Validado pela porta publica local: master, playlist de variant e segmento MPEG-
  TS retornam `200` com os content types esperados.

Arquivos-chave:

- `ui/nginx.conf`;
- `docs/api.md`.

Validacoes:

- [x] `npm --prefix ui run check`;
- [x] `docker compose up -d --build --no-deps web`;
- [x] `curl` de master, variant e segmento pelo proxy publico.

### 2026-08-05 - Retry comunica falha real de aquisicao

Fases impactadas: 2 e 5.

Entrega:

- Retries recuperaveis agora exibem a causa publica real em vez de afirmar
  incorretamente que o worker parou inesperadamente.
- Timeout padrao de stream e Compose elevado de 10 s para 25 s, ainda abaixo do
  lease de 30 s e protegido por heartbeat do worker.

Arquivos-chave:

- `src/investigation/adapters/postgres-investigation-job.ts`
- `src/config.ts`
- `compose.yml`

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 84 testes;
- [x] `git diff --check`.

Pendencias:

- Avaliar timeout por tipo de origem depois de obter metricas reais de download.

### 2026-08-05 - Modo de coleta de media configuravel

Fases impactadas: 2 e 3.

Entrega:

- Adicionada a env `VIDEO_HARNESS_MEDIA_SAMPLE_MODE` com valores `sample` | `full`
  e default `full`, preservando o comportamento atual do worker e do lab.
- `full` materializa todos os media ate o budget (recomendado para VOD curto);
  `sample` baixa somente inicio/meio/fim (escopo documentado do MVP).
- O `mode` deixou de ficar hardcoded no worker; voltou a ser controlado por env e
  a limitacao de cobertura de streams longas ficou documentada.

Arquivos-chave:

- `src/config.ts`
- `src/worker/index.ts`
- `.env.example`
- `compose.yml`
- `docs/architecture/README.md`
- `docs/architecture/phases/phase-2.md`
- `docs/api.md`
- `docs/core/START-HERE.md`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - inclui teste do default `full`, aceite de `sample`/`full` e
  rejeicao de valor invalido;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`.

Pendencias:

- Nenhuma.

Proximo passo recomendado:

- Manter `full` quando o lab exigir materializacao completa de VOD curto; usar
  `VIDEO_HARNESS_MEDIA_SAMPLE_MODE=sample` para o escopo MVP puro.

### 2026-08-05 - Perfil forense de fronteira DASH/HEVC

Fases impactadas: 2, 3 e 4.

Entrega:

- Parser puro de MPD expande `BaseURL`, periods, adaptation sets, representations
  e timelines para referencias temporais de segmentos.
- O relato de URL + descricao permanece a unica entrada. Horario e alegacao de
  troca sao extraidos como pistas `reported`, nao como fatos do player.
- Coletor DASH seleciona 4K, Full HD, intermediaria e audio, preserva init/media,
  hash SHA-256 e metadados HTTP dentro do budget existente.
- Probe fMP4 local verifica estrutura, `tfdt`, `tfhd`, `trun`, `mdat`, timestamps,
  sync flags, NAL HEVC inicial e configuracao `hvcC`/VPS/SPS/PPS.
- Report e UI mostram ladder e matriz A->A, B->B, A->B, B->A estrutural; o resultado
  de decoder e explicitamente `not_run` sem player/hardware.
- Artifacts preservados podem ser listados e baixados por endpoints do caso.

Arquivos-chave:

- `src/stream-tools/dash-mpd.ts`
- `src/stream-tools/isobmff.ts`
- `src/investigation/application/analyze-dash-forensics.ts`
- `src/investigation/adapters/http-media-sample-collector.ts`
- `ui/src/components/InvestigationReport.tsx`

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 84 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`.

Pendencias:

- Expandir suporte para `SegmentBase`/`sidx`, MPD dinamico, byte ranges, DRM e
  reproducao de decoder/Tizen.
- Adicionar fixtures DASH fMP4/HEVC com anomalias conhecidas para testar matrix e
  parser de boxes em bytes reais.

Proximo passo recomendado:

- Criar fixtures DASH fMP4/HEVC deterministicos para gap, overlap, IRAP ausente,
  parameter sets divergentes e fragmento truncado; depois executar a matriz em
  um decoder controlado no laboratorio.

### 2026-07-23 - Geradores deterministas de fixtures para evals

Fases impactadas: 2 e 3.

Entrega:

- Adicionado `evals/` com geradores TypeScript para quatro HLS VODs sinteticos:
  freeze de frames com audio continuo, controle saudavel que relata freeze,
  tela preta e silencio de audio.
- O runner valida a playlist HLS, segmentos, tracks H.264/AAC e executa o
  detector correspondente (`freezedetect`, `blackdetect` ou `silencedetect`) como
  oraculo do fixture.
- A geracao usa apenas argumentos estruturados de FFmpeg; os arquivos ficam em
  diretorio temporario e sao removidos ao final. `--keep` preserva um caso para
  depuracao. `evals/.generated/` e `.eval-dist/` permanecem ignorados pelo Git.
- Adicionados `npm run eval:check` e `npm run eval:fixtures`.

Arquivos-chave:

- `evals/core/fixture-runner.ts`
- `evals/core/hls.ts`
- `evals/cases/*.eval.ts`
- `evals/run-fixtures.ts`
- `tsconfig.evals.json`

Validacoes:

- [x] `npm run eval:check`;
- [x] `npm run eval:fixtures`;
- [x] `git diff --check`.

Pendencias:

- Criar runner end-to-end que sirva o fixture, inicie uma investigation real e
  avalie ferramentas usadas, evidencia e conclusao sem comparar texto literal.

Proximo passo recomendado:

- Evoluir `EvidenceBundle` para evidencias estruturadas de detectores e conectar
  os evals ao pipeline completo.

### 2026-07-23 - Progresso real da equipe de IA na timeline

Fases impactadas: 3 e 4.

Entrega:

- O port `InvestigationAI` aceita `onProgress` com lifecycle real e limitado dos
  quatro runs de IA (`started`, `completed`, `failed`, mais `completed`/`total`
  contados, nunca estimados).
- O adapter Pi emite progresso por especialista e pelo Lead; falha do callback
  nao derruba a analise e e registrada em log seguro.
- O worker publica cada etapa como `investigation.observation` com
  `actor` = identificador do agente e payload `stage: "ai_agent"`, serializadas
  para preservar a ordem dos event IDs; falhas carregam a limitacao publica.
- A tela do caso substitui os ~30 s estaticos de "Aia is working" por um
  checklist vivo de Pip, Coda, Mara e Lead (waiting/analyzing/done/failed) com
  contador "N of 4"; eventos `started` alimentam so o checklist e conclusoes
  viram posts com a persona do especialista.

Arquivos-chave:

- `src/investigation/ports/investigation-ai.ts`
- `src/investigation/adapters/pi-investigation-ai.ts`
- `src/investigation/application/run-investigation.ts`
- `ui/src/components/InvestigationFeed.tsx`
- `docs/api.md`
- `docs/ui/UI-GUIDE.md`

Checklist de validacao:

- [x] `npm run check`;
- [x] `npm test` - 76 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`;
- [x] Compose reconstruido e saudavel;
- [x] smoke real HLS (`test-streams.mux.dev`): investigation
  `fa8feaed-c754-45e2-a084-90dee96c045c` concluida com os 8 eventos `ai_agent`
  ordenados (3 started, 3 completed, lead started/completed), contador 0-4 de 4
  e report com os quatro agentes `completed` e confidence `0.62`.

Pendencias:

- A revisao pos-playback continua sem eventos de progresso intermediarios
  (decisao de escopo; o report atual segue visivel durante ela).

Proximo passo recomendado:

- Reorganizar a UI do report para apresentar primeiro conclusao, confianca e
  recomendacoes, mantendo findings tecnicos e limitacoes auditaveis.

### 2026-07-23 - Playback browser e revisao de report

Fases impactadas: 3 e 4.

Entrega:

- Sessao de playback persistida e endpoints para iniciar, concluir, falhar e ler
  a ultima tentativa.
- Player hls.js opt-in na pagina do caso, com limites de duracao e mensagem clara
  para falhas de CORS.
- Worker revisa o report apos telemetria e publica `investigation.report_updated`.
- Tools Pi restritas a fatos de samples preservados.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 72 testes;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`.

Pendencias:

- Cobrir endpoints e job de playback com testes dedicados e fazer smoke test em
  Compose com uma origem HLS que habilite CORS.


### 2026-07-23 - HLS localhost e media playlist direta

Fases impactadas: 2 e 3.

Entrega:

- O Compose local mapeia somente o hostname exato `localhost` para
  `host.docker.internal`; a policy padrao continua bloqueando destinos privados.
- IPs privados literais, redirects que saem do alias e URLs publicas que tentam
  redirecionar para o alias continuam bloqueados.
- O sampler inclui o root quando a URL submetida ja e uma HLS media playlist.
- Falhas deterministicas nao retryable exibem na timeline a mensagem publica
  especifica em vez de dizer incorretamente que todas as tentativas acabaram.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 72 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`;
- [x] Compose reconstruido e saudavel;
- [x] smoke contra `http://localhost:8080/index.m3u8`.

Smoke local:

- investigation: `cf35b4a9-d42e-45c0-a02a-a1ba6ca08288`;
- tres segmentos MPEG-TS preservados e inspecionados com FFprobe;
- H.264 e AAC observados nas tres amostras;
- audio inicial observado cerca de 1,955 s depois do video no primeiro segmento;
- tres especialistas e Lead Investigator concluidos;
- report com sete findings de IA, cinco recomendacoes e causa provavel persistida.

Proximo passo recomendado:

- Melhorar a hierarquia visual do report e expor claramente as analises por
  especialista, conclusao, recomendacoes e limitacoes.

### 2026-07-23 - Agentes Pi validados de ponta a ponta

Fase impactada: 3.

Entrega:

- `confidence` nao finita, ausente, nula ou fora da faixa passa a confidence
  limitada sem derrubar a resposta inteira.
- Findings sao validados individualmente; um item malformado nao invalida o
  summary nem os demais findings do especialista.
- Prompts de especialista e Lead exigem JSON unico e confidence finita entre
  zero e um; o segundo attempt recebe instrucao explicita de correcao do contrato.
- Logs seguros registram inicio, status HTTP, conclusao, duracao e categoria de
  falha por agente sem persistir prompt, resposta bruta ou chave.
- Timeout padrao do runtime e Compose alinhado em 45 segundos.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 67 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`;
- [x] Compose reconstruido com API, worker, web e PostgreSQL saudaveis;
- [x] smoke real HLS MPEG-TS com provider configurado.

Smoke real:

- URL: `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`;
- investigation: `3143d345-81ae-4fd4-befe-37a46f37d9a4`;
- especialistas timeline/playback, container/encoding e manifest/delivery
  concluidos;
- Lead Investigator concluido;
- report persistido com causa provavel, confidence `0.74`, 12 findings citando
  evidence IDs, seis recomendacoes e limitacoes;
- falha transitoria inicial de manifest/delivery recuperada pelo retry.

Proximo passo recomendado:

- Melhorar a hierarquia visual do report para separar conclusao, recomendacoes,
  analyses dos especialistas, evidencias deterministicas e limitacoes.

### 2026-07-23 - Resiliencia do boundary Pi

Fase impactada: 3.

Entrega:

- Saidas Pi agora aceitam `confidence` numerica serializada como string.
- Cada especialista e o Lead repetem uma vez quando a resposta esta vazia ou nao
  atende ao contrato JSON; o estado final do agente tambem serve de fallback para
  extrair a mensagem do provider.
- Adicionados testes de coercao para specialist e Lead.

Validacoes:

- [x] `npm run check`;
- [x] `npm test` - 64 testes;
- [x] `npm run build`;
- [x] `npm --prefix ui run check`;
- [x] `npm --prefix ui run build`;
- [x] `git diff --check`.

Proximo passo recomendado:

- Reconstruir o Compose e criar uma nova investigation para validar os quatro
  agentes com o provider configurado.

### 2026-07-22 - Corte HLS MPEG-TS e agentes Pi

Fases impactadas: 2 e 3.

Entrega:

- O MVP foi explicitamente limitado a HLS MPEG-TS; DASH, CMAF, DRM e byte ranges
  foram adiados para evitar diluir a validacao do fluxo principal.
- O sampler escolhe inicio, meio e fim de cada playlist media selecionada.
- Adicionado adapter Pi com tres especialistas sem tools e um Lead Investigator.
  O core depende apenas do port `InvestigationAI` e valida saidas estruturadas.
- O report preserva a camada deterministica e adiciona findings/recomendacoes da
  IA somente quando eles citam evidence IDs existentes.

Pendencias:

- Fixtures MPEG-TS de continuidade, A/V offset e keyframe ainda precisam ser
  adicionadas; o smoke com provider Pi real depende da chave do operador.

### 2026-07-22 - Amostra HLS e FFprobe estruturado

Fase impactada: 2.

Entrega:

- Media playlists agora descrevem segmentos, sequencias, duracoes, discontinuity,
  `EXT-X-MAP`, byte ranges e criptografia declarada.
- Worker coleta no maximo um segmento por variant/rendition selecionada e seu init
  segment, pela mesma fronteira SSRF usada para manifests.
- A amostra possui limite de 20 MiB por resposta e 20 MiB agregado por padrao.
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
