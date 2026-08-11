# API - Video Harness Space

Status: Investigate, clone HLS VOD e DASH VOD estatico e data plane de Record
estao implementados. Investigate produz transicoes ABR candidatas a partir da
URL; Record correlaciona transicoes efetivamente observadas no journal. Evidencia
de player/device permanece opcional e nunca e inferida quando ausente. Toda
investigation nova inclui um `AbrAssessment` HLS ou DASH.

Prefixo do control plane: `/v1`. O data plane consumido pelo device usa
`/streams/recordings/:recordingId/*`. A URL e fixa por recording: iniciar ou
encerrar um playback run nunca muda a URL que o device ja tem. Cada request
resolve o run aberto atual para aplicar o perfil de rede e atribuir o journal;
sem run ativo, o clone e servido com o perfil baseline.

## Diagrama

```mermaid
flowchart TD
    Client[Web client] --> Health[GET /v1/health]
    Client --> Create[POST /v1/investigations]
    Client --> Detail[GET /v1/investigations/:id]
    Client --> Events[GET /v1/investigations/:id/events - SSE]
    Client --> Report[GET /v1/investigations/:id/report]
    Report --> AbrAssessment[EvidenceBundle.abr]
    Client --> AiRuns[GET /v1/investigations/:id/ai-runs]
    Client --> Artifacts[GET /v1/investigations/:id/artifacts]
    Client --> Artifact[GET /v1/investigations/:id/artifacts/:artifactId]
    Client --> Playback[POST /v1/investigations/:id/playback-sessions]
    Playback --> Review[worker playback_synthesis]
    Review --> Report
    Client --> Share[GET /v1/reports/shared/:token]
    Client --> CreateRecording[POST /v1/recordings]
    CreateRecording --> RecordingWorker[worker recording job]
    RecordingWorker --> RecordingStore[(recording storage)]
    Client --> Recording[GET /v1/recordings/:id]
    Client --> RecordingEvents[GET /v1/recordings/:id/events - SSE]
    Client --> CreateRun[POST /v1/recordings/:id/playback-runs]
    Client --> LatestRun[GET /v1/recordings/:id/playback-runs/latest]
    Client --> FinishRun[POST /v1/recordings/:id/playback-runs/:runId/finish]
    Client --> Run[GET /v1/recordings/:id/playback-runs/:runId]
    Client --> Requests[GET /v1/recordings/:id/playback-runs/:runId/requests]
    Client --> AbrSwitches[GET /v1/recordings/:id/playback-runs/:runId/abr-switches]
    Device[Device/player] --> DataPlane[GET /streams/recordings/:recordingId/*]
    DataPlane --> RecordingStore
    DataPlane --> Requests
    Requests --> AbrSwitches
```

## Referencia rapida

| Status | Method | Path | Descricao |
|---|---|---|---|
| Implementado | GET | `/v1/health` | Saude da API e PostgreSQL |
| Implementado | POST | `/v1/investigations` | Criar investigacao e enfileirar pipeline |
| Implementado | GET | `/v1/investigations/:id` | Estado atual e metadados do caso |
| Implementado | GET | `/v1/investigations/:id/events` | Historico e stream SSE da timeline |
| Implementado | GET | `/v1/investigations/:id/report` | Report final, incluindo baseline `AbrAssessment` em coletas novas |
| Implementado | GET | `/v1/investigations/:id/ai-runs` | Prompts e pacote de evidencia enviados em cada chamada de IA |
| Implementado | GET | `/v1/investigations/:id/artifacts` | Lista artifacts preservados do caso |
| Implementado | GET | `/v1/investigations/:id/artifacts/:artifactId` | Baixa um artifact preservado |
| Implementado | POST | `/v1/investigations/:id/playback-sessions` | Iniciar validacao explicita no navegador |
| Implementado | GET | `/v1/investigations/:id/playback-sessions/latest` | Ultima validacao do caso |
| Implementado | POST | `/v1/investigations/:id/playback-sessions/:sessionId/complete` | Persistir telemetria e enfileirar revisao |
| Implementado | POST | `/v1/investigations/:id/playback-sessions/:sessionId/fail` | Encerrar tentativa sem mudar o report |
| Planejado | GET | `/v1/reports/shared/:token` | Report compartilhado por token |
| Implementado R1/R2 | POST | `/v1/recordings` | Criar recording HLS ou DASH VOD e enfileirar coleta |
| Implementado R1 | GET | `/v1/recordings/:id` | Estado, cobertura e falha publica |
| Implementado R1 | GET | `/v1/recordings/:id/events` | Historico e SSE do recording |
| Implementado R1 | POST | `/v1/recordings/:id/playback-runs` | Criar experimento; devolve a URL fixa do recording |
| Implementado R1 | GET | `/v1/recordings/:id/playback-runs/latest` | Último run aberto, para restaurar a tela após refresh |
| Planejado R1 | GET | `/v1/recordings/:id/playback-runs/:runId` | Estado e resumo ABR do run |
| Implementado R1 | GET | `/v1/recordings/:id/playback-runs/:runId/requests` | Ultimos delivery requests do run |
| Implementado R2 | GET | `/v1/recordings/:id/playback-runs/:runId/abr-switches` | `AbrSwitchEvidence` por transicao observada no journal |
| Implementado R1 | POST | `/v1/recordings/:id/playback-runs/:runId/finish` | Encerrar run e congelar o resumo |
| Implementado R1/R2 | GET | `/streams/recordings/:recordingId/*` | URL fixa por recording; serve recursos publicados com shaping do run ativo |

## Criar investigacao

```http
POST /v1/investigations
Content-Type: application/json
Idempotency-Key: <client-generated-key>
```

```json
{
  "url": "https://example.test/live/master.m3u8",
  "problemDescription": "Quality oscillates on a stable connection and the video freezes during a downshift. Player logs can be pasted here when available."
}
```

Resposta: `202 Accepted`.

```json
{
  "investigation": {
    "id": "uuid",
    "sourceUrl": "https://example.test/live/master.m3u8",
    "state": "queued",
    "createdAt": "2026-07-21T12:00:00.000Z",
    "updatedAt": "2026-07-21T12:00:00.000Z"
  },
  "replayed": false
}
```

`Idempotency-Key` e obrigatorio. Repetir a mesma request retorna a mesma
investigacao com `replayed=true` e header `x-idempotency-replayed: true`. Reutilizar
a chave com outro payload retorna `409 IDEMPOTENCY_CONFLICT`.

Somente `url` e obrigatoria. `problemDescription` aceita ate 20.000 caracteres e
pode conter sintomas, modelo/firmware e trechos de log de qualquer player. Esse
texto e persistido como contexto relatado: nomes de eventos encontrados nele nao
viram callbacks observados nem capability evidence.

## State machine inicial

```text
queued -> validating -> collecting -> analyzing -> synthesizing -> completed
   |          |             |            |              |
   +----------+-------------+------------+--------------+-> failed
```

## SSE

```http
GET /v1/investigations/:id/events
Accept: text/event-stream
Last-Event-ID: 42
```

Eventos previstos no contrato:

- `investigation.snapshot`;
- `investigation.state_changed`;
- `investigation.observation`;
- `investigation.evidence_found`;
- `investigation.hypothesis_updated`;
- `investigation.report_ready`;
- `investigation.failed`;
- `ping`.

Todo evento de produto e persistido antes de ser enviado. `ping` e transporte e
nao precisa ser persistido.

A conexao envia primeiro todos os eventos com `id > Last-Event-ID` e continua
consultando o PostgreSQL. Eventos de produto usam:

```text
id: 42
event: investigation.event
data: { ...InvestigationEvent }
```

O payload contem `id`, `investigationId`, `type`, `actor`, `message`, `payload` e
`createdAt`. A API envia `ping` a cada 15 segundos quando nao ha atividade.
`investigation.playback_completed` informa a revisao pendente e
`investigation.report_updated` informa que ela terminou; o caso permanece
`completed` durante esse processo.

### Progresso da analise de IA

Enquanto o caso esta em `analyzing`, o worker publica uma observacao por etapa
real de cada agente de IA. O `actor` e o identificador do agente
(`timeline-playback`, `container-encoding`, `manifest-delivery`,
`abr-switch-investigator` ou `lead-investigator`) e o payload tem a forma:

```json
{
  "state": "analyzing",
  "stage": "ai_agent",
  "agent": "timeline-playback",
  "agentStage": "started",
  "completed": 0,
  "total": 5
}
```

`agentStage` pode ser `started`, `completed` ou `failed`. `completed` e `total`
contam o conjunto conhecido e limitado de runs. HLS e DASH usam tres
especialistas gerais, o ABR Quality Investigator e o Lead (`total=5`). O agente
ABR roda mesmo sem sintoma ABR relatado ou transicao detalhada. Nao sao
estimativa. Para respeitar limites usuais do provider, no maximo dois
especialistas fazem chamadas de IA simultaneamente; os demais aparecem como
`started` quando realmente ocupam um slot. Em `failed`, a `message` carrega a limitacao
publica da falha, sem conteudo de prompt ou raciocinio.

### Progresso da coleta de evidencia

Enquanto o caso esta em `collecting`, o worker publica uma observacao por etapa
real de coleta. O `actor` e `Network Agent` para fetches de manifest e
`Media Agent` para amostragem de media e FFprobe. O payload tem a forma:

```json
{
  "state": "collecting",
  "stage": "collection",
  "collectionStage": "media_sample",
  "completed": 12,
  "total": 40
}
```

`collectionStage` pode ser `root_manifest`, `variant_manifest`,
`rendition_manifest`, `media_sample` ou `media_probe`. `completed` e `total`
contam items ja coletados a partir do manifest parseado (nunca estimativas);
etapas de manifest nao possuem contador. As observacoes de coleta sao
persistidas e auditaveis pela API, mas a UI nao as exibe como posts individuais:
durante a coleta um card vivo mostra o passo atual e, ao final, o evento
`investigation.evidence_found` resume o que foi preservado.

## Consultar investigacao

```http
GET /v1/investigations/:id
```

Retorna `{ "investigation": Investigation }` ou `404 INVESTIGATION_NOT_FOUND`.

## Consultar report

```http
GET /v1/investigations/:id/report
```

Retorna `{ "report": InvestigationReport }`. Antes da conclusao retorna
`404 REPORT_NOT_READY`. Reports antigos da Fase 1 possuem
`placeholder=true`. A coleta de manifest da Fase 2 produz `placeholder=false`,
`generatedBy=deterministic-manifest-v2` e um `EvidenceBundle` v2 com source,
manifests, media samples, observations e limitations. Reports anteriores com
`generatedBy=deterministic-manifest-v1` e `EvidenceBundle` v1 continuam aceitos.
Para masters HLS, o bundle inclui `hls.variants`, `hls.renditions` e
`hls.selection`. `manifests` pode conter os logical keys `manifest/root`,
`manifest/variant/0` e `manifest/rendition/audio/0`. A selecao atual usa maior
bandwidth e no maximo uma rendition de audio vinculada. O report mais recente usa
`generatedBy=deterministic-media-v1`: alem dos manifests, `mediaSamples` pode
trazer init/media artifacts, sequencia, duracao declarada e o resultado
estruturado do FFprobe (container, tracks, codecs e timestamps). O modo default
`full` coleta uma janela contigua de ate `VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS`
(padrao 60s) por variant, centrada no horario de incidente relatado quando
existir; sem horario, a janela parte do inicio. O modo `sample` baixa somente
inicio/meio/fim. Os limites de bytes funcionam como redes de seguranca. A coleta
e limitada e nao representa uma simulacao completa de playback.

Reports novos tambem incluem `evidence.abr` (`AbrAssessment` schema v1):
`protocol`, `verdict`, `reportedPriority`, `coverage`, `ladder`, `findings`,
`transitions`, `transitionMatrix` e `recommendedMeasurements`. O baseline usa a
ladder declarada completa. `NO_ISSUE_DETECTED` significa apenas que nenhuma
anomalia foi encontrada dentro da cobertura descrita; nao comprova playback,
decode ou render perfeitos. Reports historicos sem `abr` continuam aceitos.

Quando `VIDEO_HARNESS_AI_API_KEY` esta configurada, o mesmo report pode incluir
`content.ai`, com findings, recomendacoes e execucoes dos especialistas Pi. Todo
finding de IA referencia apenas IDs presentes na evidencia serializada; sem chave
o report deterministico continua sendo concluido com a limitacao correspondente.

### Auditoria de prompts de IA

`GET /v1/investigations/:id/ai-runs` retorna `{ "runs": AiPromptAudit[] }`
depois que o primeiro report estiver pronto. Cada item representa uma chamada
efetiva ao modelo, inclusive retries, e contem `agentId`, `attempt`,
`provider`, `model`, `systemPrompt`, `prompt`, `toolNames`, `toolCalls` e o estado publico da
tentativa. O campo `prompt` e o pacote exato de contexto e evidencia fornecido
ao especialista; para o Lead ele tambem inclui os resultados dos especialistas.
`toolCalls` preserva a entrada e a evidencia retornada por cada ferramenta que o
modelo realmente utilizou.

Esse endpoint e exclusivo do workspace: os dados podem conter URLs de origem e
detalhes de evidencia. Ele nao deve ser exposto por links compartilhados. A
auditoria mostra instrucoes e entradas fornecidas ao modelo, nunca chain of
thought ou raciocinio interno do modelo.

### Avaliacao ABR e especializacao DASH

O `AbrAssessment` e independente de protocolo, fabricante e player. Para HLS ele
avalia imediatamente topologia/progressao da ladder declarada e registra que a
amostragem atual cobre somente uma variant representativa. Para DASH ele agrega
tambem a especializacao de transicoes. Um problema relatado prioriza direcao,
resolucoes e horario; nao liga/desliga a avaliacao.

`EXPECTED_RESOLUTION_SWITCH` e `EXPECTED_DECODER_RECONFIGURATION` sao fatos
neutros: trocar dimensoes, HEVC level, INIT ou SPS faz parte de ladders que usam
reinitialization. Esses diffs nao produzem `Issues found` nem `ABR_INIT_001` por
quantidade. Risco exige uma classificacao explicitamente anormal, switching
contract incompatível, decode falhando, capability mismatch ou comportamento de
player observado e correlacionado.

Para MPDs DASH estaticos suportados, `dash` traz
Periods/AdaptationSets/Representations normalizados e switching contracts; a
evidencia detalhada de INIT/SAP/timeline fica em `dash.switches`, enquanto
`abr.transitions` e `abr.transitionMatrix` carregam os resumos protocol-neutral.
Cada switch vindo apenas da URL usa
`evidenceBasis=URL_STATIC_ANALYSIS` e `transitionStatus=CANDIDATE`. Sem logs de
player, a API ainda verifica INIT, sample entry, hvcC, VPS/SPS/PPS, IRAP/SAP e
timeline normalizada, mas nao confirma que o device realizou a troca.

O pacote do `abr-switch-investigator` contem o assessment completo e compacto,
com ladder, cobertura, findings, matriz e a transicao mais relevante segundo
risco deterministico e pistas explicitamente relatadas. Nao existe resolucao
fixa na priorizacao. Dumps integrais de packets/frames nao entram no prompt; os
bytes brutos continuam preservados como artifacts. O candidato prioritario recebe testes FFmpeg
source standalone, target standalone, target boundary e, quando
`bitstreamSwitching=true`, switching compatibility com um unico decoder context.
`PLATFORM_SUSPECTED` exige evidencia real
de device, callbacks, delivery, decode e conformance e portanto nao pode ser
produzido somente pela URL ou por texto relatado.

## Artifacts

`GET /v1/investigations/:id/artifacts` retorna a lista de artifacts preservados
sem expor `storageKey`. `GET /v1/investigations/:id/artifacts/:artifactId` devolve
o byte original como attachment. Esses endpoints sao para o workspace do caso;
links compartilhados devem usar uma camada de redacao/autorizacao futura.

## Validacao de playback no navegador

Disponivel apenas apos o primeiro report e iniciada por acao explicita.
`POST /v1/investigations/:id/playback-sessions` aceita opcionalmente
`{ "requestedDurationMs": 30000 }` (5 a 60 segundos) e devolve a sessao e a URL
original. O browser toca a origem diretamente com hls.js (ou HLS nativo) e envia
tempos, stalls, fragmentos, qualidade, frames descartados, erros HLS limitados e
limitations para `/complete`.

Nao sao enviados comandos, URLs derivadas, headers, bytes de midia ou logs do
console. A origem precisa habilitar CORS para a pagina. A telemetria vira artifact
e um job `playback_synthesis` revisa o report sem bloquear ou substituir o report
inicial em caso de falha.

Falhas de coleta podem encerrar a investigation com codigos como:

- `STREAM_DESTINATION_BLOCKED`;
- `STREAM_REQUEST_TIMEOUT`;
- `STREAM_RESPONSE_TOO_LARGE`;
- `STREAM_TOO_MANY_REDIRECTS`;
- `STREAM_HTTP_ERROR`;
- `UNSUPPORTED_MANIFEST`.

O runtime padrao bloqueia localhost e redes privadas. Somente o Docker Compose
local configura o hostname exato `localhost` como alias para o host de
desenvolvimento; IPs privados literais e redirects para outros destinos privados
continuam bloqueados. URLs publicas tambem nao podem redirecionar para o alias
localhost.

## Record HLS e DASH VOD - contratos R1/R2

O worker aceita HLS VOD clear/MPEG-TS com 2--8 variants e DASH VOD `static`
clear/fMP4 com `SegmentTemplate` e 2--8 video representations. Para DASH o MPD
local referencia somente init e segmentos ja registrados. Live/dynamic, DRM,
`SegmentBase` e byte ranges falham explicitamente antes da publicacao.

### Criar recording

```http
POST /v1/recordings
Content-Type: application/json
Idempotency-Key: <client-generated-key>
```

```json
{
  "url": "https://example.test/vod/master.m3u8",
  "protocol": "hls",
  "durationSeconds": 120,
  "startSeconds": 0
}
```

Regras iniciais:

- `url` aceita somente HTTP(S), sem credenciais embutidas;
- `protocol` aceita `hls` (default) ou `dash`;
- `durationSeconds` fica entre 30 e 600, default 120;
- `startSeconds` fica entre 0 e 86.400, default 0;
- o backend sempre tenta materializar toda a ladder suportada;
- `Idempotency-Key` e obrigatorio e segue a semantica de Investigate.

Resposta: `202 Accepted`.

```json
{
  "recording": {
    "id": "uuid",
    "sourceUrl": "https://example.test/vod/master.m3u8",
    "protocol": "hls",
    "state": "queued",
    "requestedDurationSeconds": 120,
    "requestedStartSeconds": 0,
    "createdAt": "2026-08-05T12:00:00.000Z",
    "updatedAt": "2026-08-05T12:00:00.000Z"
  },
  "replayed": false
}
```

State machine:

```text
queued -> validating -> collecting -> ready
   |          |             |
   +----------+-------------+-> failed
```

`ready` significa que manifests, recursos e metadata foram publicados
atomicamente. Um workspace parcial nunca recebe playback URL.

Para DASH, antes do download o servidor estima a janela usando os bitrates
declarados das representations. Se a ladder exceder o teto agregado de 1 GiB,
retorna falha definitiva `STREAM_RESPONSE_TOO_LARGE`; reduza a janela solicitada.

### Consultar recording

```http
GET /v1/recordings/:id
```

Quando pronto, o contrato final incluira:

- cobertura solicitada e efetiva;
- bytes e quantidade de recursos;
- variants com ID, bandwidth, resolucao e codecs;
- renditions gravadas;
- `abrEligible`, verdadeiro somente quando existem pelo menos duas variants de
  video tocaveis;
- limitations e falha publica opcional.

Storage keys, paths locais e URLs derivadas da origem nao sao expostos.

### Eventos do recording

```http
GET /v1/recordings/:id/events
Accept: text/event-stream
Last-Event-ID: 42
```

Usa o mesmo formato de transporte SSE de investigations, com evento
`recording.event`. O transporte ja esta implementado; os tipos que o coletor HLS
adicionara sao:

- `recording.created`;
- `recording.state_changed`;
- `recording.manifest_validated`;
- `recording.ladder_discovered`;
- `recording.variant_started`;
- `recording.variant_completed`;
- `recording.published`;
- `recording.failed`.

Contagens publicadas representam trabalho real. Nao existe percentual estimado.

### Criar playback run

Disponivel somente quando o recording esta `ready`.

Sem `profile`, a API usa `baseline` (100.000 Kbps, 0 ms): o modo normal. A UI
envia esse profile explicitamente para `Start normal`; `Force ABR` envia o preset
com os tres stages Good, constrained e recovery.

Para separar defeito de representation de uma troca ABR, o perfil de run
`1080p control (no ABR)` faz a URL assinada daquele run entregar um MPD derivado
somente de recursos locais. Ele mantem a representation 1920x1080 de maior
bitrate (e o audio), sem outra representation de video para o player escolher.

```http
POST /v1/recordings/:id/playback-runs
Content-Type: application/json
```

```json
{
  "profile": {
    "schemaVersion": 1,
    "name": "downshift-and-recovery",
    "stages": [
      { "afterVideoRequests": 0, "bandwidthKbps": 12000, "latencyMs": 30 },
      { "afterVideoRequests": 3, "bandwidthKbps": 1200, "latencyMs": 200 },
      { "afterVideoRequests": 8, "bandwidthKbps": 12000, "latencyMs": 30 }
    ]
  },
  "maxDurationSeconds": 300
}
```

Validacao de profile v1:

- entre 2 e 8 stages;
- primeiro `afterVideoRequests` igual a zero;
- triggers inteiros, unicos e estritamente crescentes;
- `bandwidthKbps` entre 128 e 100.000;
- `latencyMs` entre 0 e 5.000;
- `maxDurationSeconds` entre 30 e 900, default 300.

Resposta: `201 Created`.

```json
{
  "run": {
    "id": "uuid",
    "recordingId": "uuid",
    "state": "created",
    "profile": {
      "schemaVersion": 1,
      "name": "downshift-and-recovery",
      "stages": []
    },
    "createdAt": "2026-08-05T12:05:00.000Z",
    "expiresAt": "2026-08-06T12:05:00.000Z"
  },
  "playbackUrl": "https://vhs.example/streams/recordings/<recordingId>/index.m3u8"
}
```

O array `stages` aparece completo na resposta real; foi abreviado apenas neste
exemplo. A URL de playback e fixa por recording e permanece a mesma entre runs;
o servidor resolve o run aberto atual a cada request. Iniciar um run escolhe o
perfil de shaping e passa a gravar o journal para aquele run; encerrar o run
mantem a URL servindo o clone com o perfil baseline. O journal de requests
continua sendo gravado de forma assincrona e nao bloqueia o stream.

O clock do profile comeca no primeiro request de video. Runs expiram 24 horas
apos a criacao; expirados nao aplicam shaping. Manifests recebem a latencia do stage, mas nao consomem o bucket;
video e audio sao emitidos progressivamente em blocos de 16 KiB sob o mesmo
bucket por run. O contador de stages e efemero no processo nesta etapa; o journal
persistido no Slice 5 passara a ser a fonte de verdade apos reinicio.

### Consultar e finalizar playback run

```http
GET /v1/recordings/:id/playback-runs/:runId
POST /v1/recordings/:id/playback-runs/:runId/finish
```

`GET /v1/recordings/:id/playback-runs/latest` retorna o último run ainda aberto
e reemite deterministicamente sua mesma URL assinada. Retorna `{ "playback": null }`
quando não existe run aberto. A tela Record usa esse endpoint ao carregar para
restaurar um stream ativo após refresh.

`POST .../finish` muda o run para `completed` e grava um marcador de revogação
durável no storage. O data plane verifica esse marcador antes de abrir o arquivo,
então uma URL válida recebe `410 PLAYBACK_RUN_FINISHED` imediatamente após parar,
sem consulta ao PostgreSQL.

State machine:

```text
created -> active -> completed
   |          |
   +----------+-> expired
   +----------+-> failed
```

O GET inclui contagens de requests, stage atual, bytes entregues e o resumo:

```json
{
  "abrResult": {
    "status": "observed",
    "requestLevelOnly": true,
    "transitions": [
      {
        "direction": "downshift",
        "confidence": "sustained",
        "fromVariantId": "video-0",
        "toVariantId": "video-2",
        "atMediaSequence": 104,
        "atMs": 18420,
        "networkStageIndex": 1
      }
    ],
    "limitations": [
      "Requests prove representation selection, not decode or rendered frames."
    ]
  }
}
```

`status` pode ser `observed`, `not_observed` ou `inconclusive`. `confidence` de
uma transicao pode ser `observed` ou `sustained`.

`finish` impede novos downloads depois de um curto grace period, marca o run como
`completed` e congela o resumo. Runs vencidos retornam `410 PLAYBACK_RUN_EXPIRED`
no data plane.

### Journal de requests

```http
GET /v1/recordings/:id/playback-runs/:runId/requests?after=42&limit=100
```

O primeiro corte retorna os ultimos requests em ordem decrescente, com `limit`
entre 1 e 100 (default 10). Cursor e paginacao completa entram junto da
inferencia ABR. Cada item inclui:

- resource kind;
- variant/rendition ID;
- bandwidth e resolucao;
- media sequence;
- stage aplicado;
- latency/throughput configurados;
- inicio, fim, bytes, status e cancelamento;
- method e range limitado.

Tokens, query strings, headers sensiveis, IP completo e storage paths nunca sao
retornados.

### Evidencia correlacionada de switches ABR

```http
GET /v1/recordings/:id/playback-runs/:runId/abr-switches
```

Retorna `{ "switches": AbrSwitchEvidence[] }`. Diferentemente dos candidatos de
Investigate, esses items usam `evidenceBasis=PLAYBACK_NETWORK_OBSERVED` e
`transitionStatus=OBSERVED`, pois resultam de mudanca real de Representation no
journal do run. Cada janela associa source/target INIT, fragments disponiveis,
SAP/IRAP, timeline, delivery e findings deterministas.

O endpoint nao exige logs de player/device. Na ausencia deles, `playerEvidence`
e `deviceCapabilityEvidence` ficam ausentes e `missingEvidence` explica o que
nao pode ser concluido. Request de outra Representation prova selecao de rede,
nao decode ou render. `avplayEvidence` e aceito somente na leitura de reports
historicos.

### Data plane para devices

```http
GET /streams/recordings/:recordingId/index.m3u8
GET /streams/recordings/:recordingId/variants/:variantId/index.m3u8
GET /streams/recordings/:recordingId/variants/:variantId/segments/:sequence.ts
```

Tambem aceita `HEAD` e `OPTIONS`; recursos de media suportam um unico `Range`
valido quando o container/player exigir. A URL e fixa por recording e nunca muda
entre runs. Paths sao resolvidos exclusivamente pelos recursos publicados daquele
recording; o run aberto atual define o perfil de shaping e o runId do journal.

Regras:

- nunca buscar a origem durante playback;
- `Cache-Control: no-store` e CORS explicito;
- manifests recebem a latencia do stage, mas nao consomem throughput de media;
- media concorrente compartilha um token bucket por run (recording no baseline);
- bytes respeitam backpressure e desconexao;
- content type vem do tipo derivado do recurso;
- paths desconhecidos retornam 404 sem tocar o filesystem fora do recording;
- recordingId invalido retorna 400; sem run ativo o clone ainda e servido com o
  perfil baseline (URL nunca fica inacessivel por lifecycle de run).

O deploy deve rotear `/streams/*` sem buffering ou compressao que altere o paced
delivery. No Compose local, o Nginx da porta web encaminha explicitamente
`/streams/*` para a API; sem essa regra, o fallback SPA devolveria `index.html`
e players como VLC nao conseguiriam interpretar o manifesto.

## Erros

Formato planejado:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STREAM_URL",
    "message": "The provided URL could not be investigated.",
    "requestId": "request-id"
  }
}
```

Mensagens publicas nao devem expor paths, tokens, comandos ou detalhes internos de
rede.

## Health

```http
GET /v1/health
```

Retorna `200` quando PostgreSQL esta acessivel e `503` quando o banco esta
indisponivel.

```json
{
  "ok": true,
  "service": "video-harness-api",
  "version": "0.1.0",
  "now": "2026-07-21T12:00:00.000Z",
  "uptimeSeconds": 12,
  "database": {
    "status": "up"
  }
}
```
