# Project Status - Video Harness Space

Ultima atualizacao: **2026-08-06**

## Resumo

- Fase ativa: **Record R2 - DASH VOD**.
- Estado: **em andamento**.
- Repositorio: novo e independente.
- Runtime: API, worker, UI e PostgreSQL executaveis.
- Objetivo imediato: implementar o Slice 5 de Record: journal persistido de
  requests e inferencia de transicoes ABR.
- Investigate permanece funcional; sua proxima reorganizacao visual esta pausada.
- DASH VOD esta em implementacao sobre o data plane ja comprovado.

## Fases

| Fase | Status | Objetivo |
|---|---|---|
| 0 | Concluida | Fundacao documental, decisoes e plano executavel |
| 1 | Concluida | Thin slice completo com API, worker, Postgres, SSE e UI |
| 2 | Em andamento | Evidencia deterministica real de streaming |
| 3 | Em andamento | Investigacao assistida por IA e report estruturado |
| 4 | Planejada | UX premium e experiencia end-to-end |
| 5 | Planejada | Hardening, deploy e validacao com usuarios |
| Record R1 | Em andamento | HLS VOD, origem controlada e evidencia ABR por requests |
| Record R2 | Em andamento | DASH VOD sobre a fronteira comprovada em R1 |

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
- [ ] Persistir journal e derivar transicoes ABR.
- [ ] Entregar UX Record e smoke em device/player externo (UX inicial entregue;
  smoke e journal ABR ainda pendentes).

## Proximo passo recomendado

Fazer smoke de MPD DASH em player externo e concluir inferencia de transicoes
ABR, compartilhada por HLS e DASH.

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
