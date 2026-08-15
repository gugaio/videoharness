# Architecture Decisions

Registro leve de decisoes duradouras. Alteracoes devem incluir data, contexto e
consequencias.

## 2026-07-21 - Repositorio novo e autonomo

Decisao:

- Video Harness sera implementado em um novo repositorio.
- Kael e VHS serao referencias e fontes de codigo, nao dependencias de runtime.
- Codigo necessario sera copiado para dentro deste projeto durante o MVP.

Motivo:

- Reduzir troca de contexto, releases cruzados e contaminacao dos projetos atuais.
- Concentrar backlog, CI, deploy e ownership em um unico produto.

Consequencia:

- Duplicacao temporaria e aceita.
- Melhorias genericas so serao extraidas de volta depois da validacao.

## 2026-07-21 - Stack conhecida do Kael

Decisao:

- React + Vite em vez de Next.js.
- Fastify + TypeScript no backend.
- React Router, TanStack Query, Zod, Tailwind e Vitest.

Motivo:

- A stack atende ao produto e evita curva de aprendizado sem impacto na hipotese
  principal.

## 2026-07-21 - Arquitetura hexagonal leve

Decisao:

- Casos de uso dependem de ports para infraestrutura relevante.
- Adapters concretos vivem nas bordas.
- Composicao manual, sem container de DI.

Motivo:

- PostgreSQL, storage, ferramentas de streaming e provider de IA sao fronteiras
  reais, mas o MVP nao precisa de arquitetura cerimonial.

## 2026-07-21 - PostgreSQL para estado e jobs

Decisao:

- PostgreSQL e a unica fonte de verdade.
- Jobs usam tabela, lease, heartbeat e claim transacional.
- Eventos de investigacao sao persistidos e alimentam SSE.

Motivo:

- Permitir recuperacao e reconexao sem adicionar Redis ou broker.

## 2026-07-21 - Filesystem local com port de storage

Decisao:

- Artifacts ficam inicialmente no filesystem.
- Metadados ficam no PostgreSQL.
- A aplicacao usa `ArtifactStore` para permitir R2 futuramente.

## 2026-07-21 - Evidencia antes de IA

Decisao:

- Ferramentas deterministicas fazem analise tecnica.
- IA explica, correlaciona, formula hipoteses e recomenda proximos passos.
- Chain of thought nunca e armazenado ou exibido.

## 2026-07-21 - Acesso a streams com destino fixado

Decisao:

- O worker resolve e valida todos os enderecos antes da conexao.
- A request conecta diretamente ao IP validado, mantendo `Host` e SNI.
- Redirects sao manuais e revalidados.
- Qualquer resposta DNS contendo endereco nao publico bloqueia o destino inteiro.

Motivo:

- Validar DNS e depois deixar outro cliente resolver novamente manteria uma janela
  para DNS rebinding e SSRF.
- O fluxo principal aceita URLs arbitrarias, portanto a fronteira segura precisa
  existir antes de qualquer ferramenta de streaming.

Consequencia:

- A policy e deliberadamente conservadora e pode rejeitar hosts com DNS misto.
- Proxies corporativos e streams privados exigirao uma policy explicita futura;
  nao sao suportados no MVP publico.

## 2026-07-21 - Identidade logica e lote de artifacts

Decisao:

- Artifacts possuem `logical_key` unica por investigation.
- Uma coleta registra artifacts e evidence bundle em um unico lote PostgreSQL.
- Retries substituem o registro da mesma logical key e removem o arquivo anterior
  somente depois do commit.
- O `EvidenceBundle` v1 permanece legivel; novas coletas usam o v2 com arrays de
  manifests e media samples.

Motivo:

- A proxima fatia produz root manifest, manifests derivados e depois chunks.
- O contrato anterior assumia um unico arquivo e poderia acumular artifacts
  duplicados quando uma tentativa falhasse depois da coleta.

Consequencia:

- Collectors podem continuar pequenos, mas o application core ja aceita promover
  varios artifacts atomicamente.
- Compatibilidade de leitura evita invalidar investigations locais existentes.

## 2026-07-22 - Amostragem HLS limitada e auditavel

Decisao:

- Masters HLS sao parseadas integralmente, mas a coleta derivada fica limitada a
  uma variant e uma rendition de audio vinculada.
- A variant de maior `BANDWIDTH` e selecionada; empates preservam a ordem original.
- Audio prefere `DEFAULT=YES`, depois `AUTOSELECT=YES` e ordem da master.
- Toda URI derivada passa novamente pela fronteira SSRF e pelos limites de manifest.

Motivo:

- Obter um media manifest real prepara a amostragem e o FFprobe sem baixar uma
  ladder inteira antes de validar valor.
- Uma regra deterministica e persistida no evidence bundle torna a escolha
  reproduzivel e explicavel.

Consequencia:

- O primeiro report nao representa toda a ladder; essa limitacao fica explicita.
- Outras variants podem ser coletadas futuramente quando o relato ou uma evidencia
  justificar comparacao ABR.

## 2026-07-22 - Modelo canonico enriquecido no pipeline

Decisao:

- Cada conceito possui preferencialmente um modelo interno canonico.
- Processos sequenciais enriquecem o mesmo objeto em vez de criar tipos nomeados
  por etapa.
- Projecoes de API/evidence continuam separadas quando removem bytes ou outros
  dados exclusivos do runtime.

Aplicacao inicial:

- `Manifest` contem source, content, inspection e artifact opcional.
- `ManifestCollector` devolve uma `ManifestCollection`.
- O worker adiciona `artifact` depois do filesystem.
- `ManifestEvidence` e a projecao persistida sem `content.bytes`.

Motivo:

- `CollectedManifest`, `PromotedManifest` e `ManifestEvidence` pareciam conceitos
  distintos, embora os dois primeiros fossem apenas estados do mesmo manifesto.
- O vocabulario adicional dificultava entender o fluxo e seria repetido em
  segments e probes.

Consequencia:

- O pipeline fica mais direto e o ponto de enriquecimento permanece explicito.
- Novos tipos por etapa exigem uma justificativa concreta de fronteira ou
  invariante, nao apenas conveniencia nominal.

## 2026-07-22 - Amostra HLS local antes do FFprobe

Decisao:

- O worker baixa segmentos de inicio, meio e fim de cada playlist HLS selecionada
  e o init segment associado, quando existir.
- Quando a URL submetida ja aponta para uma media playlist, o root e amostrado
  diretamente sem exigir uma master.
- FFprobe recebe somente bytes gravados temporariamente no workspace isolado da
  investigation; URLs externas nunca sao passadas ao processo.
- Criptografia declarada e byte ranges permanecem como limitacoes da primeira
  fatia, em vez de buscar chaves ou baixar ranges sem uma policy dedicada.

Motivo:

- A amostra produz codecs, tracks e timestamps observados com custo e superficie
  de rede previsiveis.
- Separar a rede protegida do processo de midia evita abrir uma segunda fronteira
  de SSRF no FFprobe.

## 2026-07-23 - Alias localhost restrito ao Compose de desenvolvimento

Decisao:

- O runtime padrao continua bloqueando qualquer destino privado, loopback ou DNS
  misto.
- O Compose local configura somente o hostname exato `localhost` como alias
  confiavel para `host.docker.internal`.
- IPs privados literais, outros hostnames privados e redirects que saem do alias
  ou tentam entrar nele a partir de uma URL publica continuam bloqueados.

Motivo:

- Desenvolvedores precisam investigar um HLS servido na propria maquina enquanto
  o worker executa em container.
- Dentro do container, `localhost` aponta para o worker e nao para o host.
- Desabilitar a policy SSRF inteira para facilitar testes criaria um comportamento
  inseguro e diferente demais do deploy.

Consequencia:

- `http://localhost:<porta>/...` funciona no Docker Compose local quando o servidor
  do host aceita conexoes pelo gateway Docker.
- Deploys e execucoes fora do Compose so permitem localhost quando
  `VIDEO_HARNESS_STREAM_LOCALHOST_ALIAS` e configurada explicitamente.
# 2026-07-23 - Playback browser opcional como evidencia complementar

O MVP usa hls.js no browser da pessoa para validar comportamento de playback, e
nao VLC no servidor. A sessao e explicita, dura no maximo 60 segundos e persiste
somente telemetria estruturada e limitada. A coleta deterministica do worker
continua sendo a fonte dos fatos de transporte e container; playback complementa
o report sem prender o job inicial. CORS e responsabilidade da origem do stream;
nao adicionamos proxy de media neste MVP por ampliar a superficie SSRF e de
reescrita de manifests.

# 2026-07-23 - Ferramentas Pi sem shell ou rede livre

Agentes Pi podem solicitar `inspect_preserved_sample`, limitada aos logical keys
dos samples ja preservados e ao resultado deterministico de probe. O modelo nao
recebe ferramenta de shell, arquivo, URL, argumentos de ffprobe ou download.

## 2026-08-14 - Evidencia visual antes de sintese no workspace

Decisao:

- A tela principal de Investigate passa a ser um workspace de evidencias, nao uma
  timeline seguida por um report.
- Manifestos, ladder e chunks preservados sao a primeira superficie de leitura.
- Perguntas do usuario sao persistidas como atividades e nao acionam IA em
  segundo plano.
- Record/Experiments continuam sendo o unico caminho que produz URL estavel e
  resultado de playback controlado.

Motivo:

- Uma pessoa precisa entender os fatos deterministas antes de confiar nas
  hipoteses, e precisa saber exatamente quando uma nova analise foi solicitada.

Consequencia:

- O workspace pode continuar consumindo a projecao atual do report durante a
  discovery, mas a proxima fatia promove `EvidenceSnapshot`, `AgentRun` e
  `Hypothesis` a entidades persistidas independentes.

## 2026-08-15 - Agentes serializados e contexto compacto

Decisao:

- especialistas executam em serie sobre a credencial compartilhada do provider;
- o prompt inicial carrega resumos determinísticos e o indice de evidencias, mas
  nao repete URLs nem listas completas de frames/NALs;
- detalhes preservados continuam acessiveis por `inspect_preserved_sample`;
- correcao de contrato usa retry curto, enquanto rate limit usa backoff e hints do
  provider quando disponiveis; erros permanentes nao sao repetidos.

Motivo:

- duas geracoes concorrentes, somadas aos retries de JSON e ao mesmo snapshot
  volumoso enviado para cada agente, criavam bursts previsiveis de tokens/requests;
- o schema rejeitava variacoes inofensivas como `evidence_ids`, envelopes e listas
  escalares, desperdicando uma segunda geracao apesar de a resposta ser utilizavel.

Consequencia:

- a analise completa pode levar mais tempo, mas deixa de trocar confiabilidade por
  paralelismo pequeno;
- summaries e citacoes continuam obrigatorios, findings sem evidence ID conhecido
  continuam descartados e o snapshot completo permanece auditavel fora do prompt.

## 2026-08-05 - Relato do usuario como hipotese de forense DASH

Decisao:

- O fluxo forense DASH recebe somente URL e descricao livre na primeira versao.
- Horario, troca ABR e sequencia A/V extraidos do relato sao contexto `reported`,
  nunca fatos tecnicos.
- Parsers e probes deterministas verificam fronteiras candidatas; o report separa
  evidencia observada, hipotese causal e informacao que nao pode ser comprovada
  sem telemetria do player.

Consequencia:

- Nao introduzimos logs ou upload obrigatorios no intake.
- O report nao afirma que uma troca ocorreu; identifica uma sequencia candidata e
  classifica sua seguranca estrutural.

## 2026-08-08 - ABR switch com proveniencia explicita e prompt compacto

Decisao:

- `AbrSwitchEvidence` e a entidade canonica para uma transicao, tanto no fluxo de
  URL quanto no journal de um playback run.
- Evidencia somente da URL e marcada `URL_STATIC_ANALYSIS/CANDIDATE`; somente uma
  mudanca no journal recebe `PLAYBACK_NETWORK_OBSERVED/OBSERVED`.
- Logs, modelo e firmware colados em `problemDescription` ficam em
  `reportedPlayerContext`, nunca em `avplayEvidence` ou capability evidence.
- Parsers deterministas produzem MPD efetivo, boxes ISO BMFF, HEVC NAL/parameter
  sets, timeline normalizada, diffs semanticos e findings antes do LLM.
- O especialista ABR recebe somente evidencia compacta do boundary. Artifacts
  brutos permanecem disponiveis para drill-down.

Motivo:

- A investigacao precisa produzir valor com apenas uma URL sem fingir que possui
  telemetria da TV.
- Binary INIT diff, `key_frame=true` e tfdt bruto nao bastam para avaliar uma
  troca HEVC entre timescales/configuracoes diferentes.

Consequencia:

- A ausencia de logs Samsung limita apenas conclusoes de device/plataforma; nao
  bloqueia checks de authoring, contrato, SAP/IRAP, INIT e timeline.
- `PLATFORM_SUSPECTED` exige reproducao, device identificado e checks positivos
  de conteúdo/delivery/decode/conformance; texto relatado sozinho nao satisfaz a
  regra.

## 2026-08-08 - AbrAssessment protocol-neutral e especialista sempre ativo

Decisao:

- `AbrAssessment` passa a ser a raiz do diagnostico ABR para HLS e DASH, com
  ladder canonica, cobertura, verdict, findings, transicoes e medicoes faltantes.
- Toda investigation executa o baseline deterministico e o ABR Quality
  Investigator. Um sintoma ABR relatado altera a priorizacao, nao a existencia da
  analise.
- `AbrSwitchEvidence` permanece como especializacao profunda de uma transicao;
  DASH/fMP4 possui hoje a cobertura mais rica, sem contaminar o modelo raiz com
  resolucao, fabricante, sistema operacional ou player fixos.
- Parsing de `problemDescription` pertence a application de Investigation, nao a
  `stream-tools`.

Motivo:

- A qualidade adaptativa faz parte da saude de qualquer stream e nao deve herdar
  as premissas do incidente Tizen que originou o primeiro corte.
- Separar baseline, especializacoes e explicacao agentica permite aumentar a
  cobertura de HLS e comportamento observado sem reescrever o contrato central.

Consequencia:

- Reports novos carregam `evidence.abr`; campos DASH antigos permanecem aceitos
  apenas para leitura de reports historicos.
- `NO_ISSUE_DETECTED` vale somente dentro da cobertura declarada e nunca equivale
  a playback perfeito.

## 2026-08-09 - Fan-out de agentes limitado na fronteira do provider

Decisao:

- Os quatro especialistas continuam independentes, mas no maximo duas chamadas
  ao provider ficam ativas simultaneamente.
- A segunda tentativa espera um backoff fixo de um segundo; retry imediato nao
  compete com requests ainda em andamento.
- Falhas retornadas pelo SDK sao classificadas de forma segura como rate limit,
  erro 5xx, limite de contexto, autenticacao, transporte ou desconhecida. O texto
  bruto do provider nao e persistido nem mostrado.

Motivo:

- O smoke real mostrou duas de quatro chamadas simultaneas falhando juntas,
  enquanto as outras duas e o Lead concluiam. O retry imediato repetia a falha
  antes de liberar capacidade do provider.

Consequencia:

- A etapa de especialistas pode durar mais, mas deixa de transformar limite de
  concorrencia em falha deterministica de Mara e do especialista ABR.
- Eventos `started` continuam representando chamadas reais, nao fila ficticia.

## 2026-08-09 - Reconfiguracao esperada nao e risco ABR

Decisao:

- `EXPECTED_RESOLUTION_SWITCH` e `EXPECTED_DECODER_RECONFIGURATION` permanecem
  evidencia descritiva e nao geram finding de risco por quantidade de mudancas
  em INIT/SPS.
- `ABR_INIT_001` exige ao menos uma diferenca semanticamente classificada como
  `RISKY_DECODER_RECONFIGURATION`.
- Agentes nao podem recomendar resolucao fixa, separar Periods ou bloquear
  4K↔1080p apenas porque dimensoes, HEVC level, INIT ou SPS mudam.

Motivo:

- Reinitialization e comportamento normal em muitas ladders ABR. Contar largura,
  altura e level como tres mudancas promovia uma transicao valida a risco `HIGH`
  e induzia falsa causa raiz.

Consequencia:

- Uma fronteira com timeline continua, SAP/IRAP valido e apenas reconfiguracao
  esperada passa na matriz estrutural.
- Risco requer contrato incompatível, diferenca explicitamente anormal, falha de
  decode, capability mismatch ou falha real do player correlacionada.

## 2026-08-11 - URL de playback fixa por recording, run resolvido por request

Decisao:

- O data plane passa a servir `/streams/recordings/:recordingId/*`, uma URL fixa
  por recording, em vez de um token HMAC novo por playback run.
- Cada request resolve o run aberto atual (`findLatestOpen`) para escolher o
  perfil de rede e atribuir o journal; sem run ativo o clone e servido com o
  perfil baseline e sem journal.
- `VIDEO_HARNESS_PLAYBACK_SIGNING_SECRET`, `SignedPlaybackUrl` e o stop marker no
  filesystem sao removidos; encerrar um run apenas finaliza o run no banco.

Motivo:

- A URL por run mudava a cada experimento e quebrava players/device que
  cacheiam a URL. O requisito do lab e uma URL estavel que nunca dependa do
  lifecycle do run.
- Com a resolucao do run por request, o estado do run no PostgreSQL ja e a
  fonte de verdade; o token auto-contido e o marker ficam redundantes e o
  segredo de assinatura deixa de ser configuracao obrigatoria do deploy.

Consequencia:

- A URL nunca muda: iniciar ou encerrar um run mantem o device funcional; o run
  ativo determina shaping e journal, e o baseline e sempre alcançavel.
- O data plane volta a consultar PostgreSQL uma vez por request (query indexada
  simples) para resolver o run ativo; perde-se a leitura 100% stateless.
- O recordingId (UUID) atua como capability da URL; caminho invalido retorna 400
  e paths desconhecidos continuam 404 sem tocar o filesystem fora do recording.

## 2026-08-11 - Experiment como camada sobre Investigation e Record

Decisao:

- `Experiment` passa a representar a pergunta diagnostica, hipoteses, iteracoes,
  testes e conclusao. Um clone experimental continua sendo um `Recording`
  materializado pelo worker/storage existentes.
- `CloneSpec` v1 e persistido antes da execucao e compilado para um plano
  declarativo. O dominio nao recebe command lines; processos futuros exigem
  binary allowlisted e array de argumentos.
- O primeiro corte executa somente `recorded_snapshot` + `manifest_only` com
  CONTROL, selecao de representation e selecao de audio que realmente diferem do
  controle. Modos sem pipeline seguro ficam modelados e explicitamente
  indisponiveis.
- REST e a superficie programatica. MCP/skill nao entram enquanto REST cobre o
  workflow e o escopo do repositorio continua proibindo infraestrutura de agente
  adicional.

Motivo:

- Investigation ja possui a evidencia deterministica e Record ja possui SSRF,
  fila recuperavel, storage atomico e delivery. Duplicar essas fronteiras
  aumentaria risco sem melhorar o experimento.
- O requisito e fechar o loop de diagnostico no produto, nao construir um novo
  executor de media ou framework de agentes.

Consequencia:

- A migration 011 adiciona os agregados do experimento e apenas dois campos
  opcionais em `recordings` (`clone_spec`, `clone_plan`). O intake legado nao muda.
- O observer pos-Record verifica o manifest/recursos deterministicamente e somente
  entao promove o clone experimental a `READY`.
- Repackage/transcode, HLS fMP4, live proxy e DRM transform nao sao prometidos
  pelo primeiro slice. Signalling DRM continua analisavel; bypass/decryption nao.

## 2026-08-11 - Uma URL fixa por Experiment, tratamento selecionado no control plane

Decisao:

- Todos os TestRequests de um Experiment usam
  `/streams/experiments/:experimentId/index.m3u8|index.mpd`.
- `POST /v1/test-requests/:id/activate` altera atomicamente
  `experiments.active_test_request_id`; o device repete a mesma URL para CONTROL
  e tratamentos.
- Cada request resolve o recording `READY` selecionado e le somente recursos
  publicados. `Cache-Control: no-store` reduz reuso do manifest anterior.

Motivo:

- Trocar URL no device pode exigir build/deploy ou reconfiguracao fora do Harness.
  A escolha deve acontecer na UI, como a escolha de profile ABR atual.
- Uma URL por clone transforma configuracao do device em variavel acidental do
  experimento.

Consequencia:

- O operador segue a sequencia selecionar -> reproduzir novamente -> registrar
  resultado. A UI so habilita o resultado para o TestRequest selecionado.
- Se a selecao mudar enquanto um playback ainda esta em curso, requests futuros
  seguem a nova selecao; a UX orienta encerrar uma observacao antes de selecionar
  outra. O corte atual e serial por Experiment/device.

## 2026-08-05 - Record entra na validacao atual por HLS VOD

Decisao:

- Record deixa de ser apenas visao futura e passa a ser a fase ativa.
- O primeiro corte grava HLS VOD clear com toda a ladder suportada.
- DASH VOD e a fase seguinte e reutiliza as fronteiras comprovadas em HLS.
- Live, DRM, LL-HLS e emulacao de device continuam fora do corte.

Motivo:

- O caso prioritario agora e reproduzir condicoes de delivery em um device real e
  observar suas escolhas ABR sem depender do playback browser da aplicacao.
- HLS VOD reduz variaveis de ingestao e permite validar storage, origin server,
  shaping e evidencia antes de adicionar MPD/fMP4.

Consequencia:

- PRD, visao, API, UX, status e instrucoes do repositorio passam a incluir Record.
- A proxima reorganizacao visual de Investigate fica pausada, mas seu runtime
  permanece suportado.
- A decisao anterior de nao criar proxy para o playback browser continua valida
  para aquele fluxo. Record adiciona outro data plane que serve somente bytes ja
  gravados e nunca busca a origem sob demanda.

## 2026-08-05 - Recording imutavel e PlaybackRun experimental

Decisao:

- `Recording` representa os manifests e bytes publicados de forma imutavel.
- `PlaybackRun` representa uma execucao limitada com token e profile de rede.
- Um recording pode alimentar varios runs sem ser clonado novamente.
- O data plane usa rotas estaveis do Fastify em R1, nao servidores ou portas
  efemeras por recording.

Motivo:

- Separar aquisicao de experimento torna cenarios comparaveis e recuperaveis.
- Uma URL unica por run isola cache e permite atribuir requests a um device/caso.
- Rotas persistentes simplificam Compose, restart e acesso por devices.

Consequencia:

- Record possui tabelas e storage proprios, sem fingir que e uma investigation.
- O data plane serve somente recursos registrados e nunca faz proxy sob demanda.
- Tokens sao armazenados como hash e redigidos de logs.

## 2026-08-05 - Network shaping compartilhado e evidencia no nivel de request

Decisao:

- Profiles v1 usam stages deterministas de throughput e latencia.
- Todas as respostas de media concorrentes compartilham o budget do playback run.
- Requests sao mapeados para variant/representation e media sequence.
- O resultado distingue `observed`, `sustained`, `not_observed` e `inconclusive`.

Motivo:

- Atrasar e depois liberar o arquivo inteiro mede principalmente latencia e cria
  bursts irreais. Paced delivery representa melhor a capacidade disponivel.
- Um limite por response multiplicaria artificialmente a banda quando audio e
  video fossem baixados em paralelo.

Consequencia:

- O shaper precisa respeitar backpressure, cancelamento e um token bucket por run.
- Request de outra variant comprova escolha de rede, nao decode ou render.

## 2026-08-05 - Import controlado do recorder do VHS

Decisao:

- O recorte inicial parte do modulo `/home/gugaime/IA/vhs` no commit
  `d2abfbd51046`; o Kael no commit `6af169ceb096` e apenas referencia de integracao.
- Nao sera adicionada dependencia de runtime para nenhum dos dois repositorios.
- O import deve criar `src/record/README.md` com procedencia e adaptacoes.

Adaptacoes obrigatorias:

- substituir fetch generico pela fronteira segura do Video Harness;
- impor budgets e cleanup;
- validar alinhamento e `MEDIA-SEQUENCE` entre variants;
- trocar servidor efemero por data plane persistente;
- adicionar Range, shaping e request journal.

## 2026-08-08 - Coleta de media por tempo, bytes como seguranca

Decisao:

- A unidade de coleta de media na investigacao passa de bytes para tempo: no modo
  `full`, cada variant/representacao contribui uma janela contigua de ate
  `VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS` (default 60s), centrada no horario de
  incidente relatado quando existir; sem horario, a janela parte do inicio.
- Os limites de bytes continuam obrigatorios como rede de seguranca contra
  downloads sem limite, SSRF/abuso e estouro de memoria do worker; eles nao
  definem a cobertura normal.

Motivo:

- Cobertura por bytes e inconsistente: a 4K ~20 Mbps, 20 MiB cobre ~1,3s; a 300
  kbps, ~8,8min. Tempo garante a mesma janela de conteudo entre investigacoes e
  alinha a coleta ao objetivo de forense (ver a janela em volta do incidente).
- Tempo puro, sem teto de bytes, permitiria centenas de MB por investigacao em
  bitrates extremos, violando a regra de downloads sem limite e estourando a RAM
  (samples segurados em memoria).

Consequencias:

- Selecao usa tempo declarado no manifest (duracao HLS cumulativa, com fallback
  para `targetDuration`; `presentationStart/EndSeconds` no DASH).
- Defaults novos: 60s por variant, 512 MiB totais, 128 MiB por fetch.
- Samples continuam em memoria durante a coleta; streaming para disco e follow-up.

## 2026-08-11 - Manifest obrigatorio, amostra de media degradavel

Decisao:

- O manifest raiz continua sendo evidencia obrigatoria e falhas transientes nessa
  fronteira seguem a politica limitada de retry do job.
- Depois que o manifest foi validado, timeout, bloqueio ou limite de uma amostra
  de init/media vira uma limitation atribuida aquela representation. A coleta
  preserva as demais evidencias em vez de reiniciar todo o pipeline.
- A primeira falha de media interrompe somente a janela daquela representation,
  evitando acumular varios timeouts consecutivos no mesmo target lento.

Motivo:

- Uma amostra complementar lenta nao invalida MPD/HLS, ladder e outras amostras
  ja obtidas. Reiniciar tudo desperdicava rede, repetia eventos e podia terminar
  sem report mesmo com evidencia deterministica util.

Consequencia:

- Reports podem concluir com cobertura parcial explicitamente documentada.
- Cada falha degradada publica um evento persistido com tipo de recurso,
  representation/logical key, segmento de origem quando aplicavel e error code;
  URLs e credenciais nao entram nesse payload.
- Falha de manifest obrigatorio continua falhando a tentativa, mas a mensagem
  publica identifica root manifest, variant HLS ou audio rendition.
- Erros inesperados de programacao continuam falhando o job; somente erros
  tipados da fronteira segura de streaming sao degradados para limitation.

## 2026-08-11 - Retry DASH nao atravessa fronteira de workspace

Decisao:

- O materializador DASH pode baixar um conjunto pequeno de chunks em paralelo,
  mas uma falha aguarda todos os workers ja iniciados terminarem antes de ser
  devolvida ao recording worker.
- Init/chunk com erro transiente recebe ate tres tentativas locais, registradas
  como `recording.resource_retry`, antes de acionar o retry do job completo.
- Fetches de Record usam budget de tempo proprio (60s por request por default),
  separado dos 25s da amostragem de Investigate; um chunk integral de bitrate
  alto nao e semanticamente equivalente a uma amostra curta.
- Escritas continuam usando criacao exclusiva (`wx`); nao sobrescrever arquivos
  e uma invariante de integridade, nao um erro a ser silenciado.

Motivo:

- `Promise.all` rejeitava no primeiro timeout enquanto downloads irmaos ainda
  podiam gravar. O job limpava e recriava o mesmo workspace para o retry, e um
  worker antigo podia escrever na nova tentativa, causando `EEXIST` ou mistura
  de proveniencia.

Consequencia:

- Nenhuma tentativa anterior permanece gravando quando cleanup/retry comeca.
- Instabilidade pontual de CDN/DNS pode ser recuperada no recurso afetado sem
  descartar toda a ladder ja baixada naquela tentativa.
- Falha depois do limite continua explicita e segue a politica duravel do job.

## 2026-08-14 - GOP visual usa resumo deterministico compacto

Decisao:

- FFprobe continua lendo packets/frames do chunk preservado, mas o snapshot nao
  recebe o dump bruto. Ele guarda contagens completas, boundary inicial/final e
  no maximo 24 GOPs com 360 frames projetados por GOP.
- O adapter normaliza tanto os arrays separados `packets`/`frames` quanto o array
  intercalado `packets_and_frames` emitido por versoes mais novas do FFprobe.
- O agrupamento inicia em key frame ou picture type I. Audio frames nao entram no
  mapa de GOP de video.
- A UI representa I/P/B somente quando FFprobe informou o tipo. Para fMP4,
  IDR/CRA/BLA ou uma flag de sync aparecem como random access/sync; o produto nao
  inventa P/B a partir dessa sinalizacao.

Motivo:

- O workspace precisa permitir inspeção visual real sem inflar snapshots,
  respostas HTTP e inputs de agentes com o JSON bruto do FFprobe.

Consequencia:

- `totalGopCount`, `frameCount` e `truncated` tornam a cobertura auditavel.
- O artifact completo continua preservado para uma analise deterministica mais
  profunda quando o resumo nao for suficiente.

## 2026-08-14 - Coleta e analise sao dois jobs explicitos

Decisao:

- O job inicial termina em `evidence_ready` depois de publicar um snapshot
  deterministico imutavel; ele nao chama o provider de IA nem cria o report.
- `POST /v1/investigations/:id/analysis` e a unica transicao inicial para a etapa
  de agentes. Ele cria um job `investigation-analysis` idempotente.
- O segundo job referencia o snapshot atual, persiste os AgentRuns e produz o
  report final. Uma falha de IA devolve o caso a `evidence_ready`, preservando os
  fatos coletados e permitindo nova tentativa explicita.

Motivo:

- A pessoa deve compreender manifestos, ladder, chunks e GOPs antes de receber
  interpretacoes. Executar agentes automaticamente misturava fatos e hipoteses e
  tornava o CTA da interface apenas decorativo.

Consequencias:

- Investigacoes novas possuem uma pausa real e recuperavel entre coleta e IA.
- A navegacao pode alternar entre dados do stream e analise sem duplicar o caso ou
  a evidencia.
- Report, hipoteses e Experiments passam a depender da conclusao do segundo job.

## 2026-08-15 - Avaliacao de Experiment usa guardrail factual e equipe de agentes

Decisao:

- `POST /v1/experiments/:id/evaluate` cria um job recuperavel em vez de concluir
  a hipotese no request HTTP.
- A primeira camada deriva somente fatos do CONTROL, treatments, CloneSpecs,
  verificacao e TestResults. Ela define outcome, evidence IDs, claim causal
  maximo e o que nao foi estabelecido.
- Evidence Auditor, Causal Analyst e Lead Experiment Investigator rodam em serie.
  Os agentes explicam o efeito, levantam alternativas e escolhem o proximo teste,
  mas nao podem ampliar o guardrail.
- Um unico tratamento que passa enquanto CONTROL falha produz
  `PARTIALLY_SUPPORTED` quando a hipotese original e mais ampla que a variavel
  manipulada. `SUPPORTED` fica reservado para evidencia causal mais direta e
  repetida.

Motivo:

- A regra anterior promovia toda hipotese ligada a um treatment quando ele
  passava, mesmo que o clone tivesse alterado apenas representacao/ladder e a
  hipotese falasse de latencia de origem. O summary ainda alegava hipoteses
  concorrentes inexistentes.
- O produto e assistido por IA, mas o LLM deve interpretar evidencia, nao criar
  observacoes ou redefinir o alcance do experimento.

Consequencias:

- Avaliacoes ficam assincronas, reexecutaveis e observaveis por job/tentativa.
- A UI separa observacao, claim suportado, interpretacao, nao comprovado,
  alternativas, limitacoes, agentes e proximo teste.
- Avaliacoes legadas podem ser reprocessadas sem repetir o playback; profundidade
  adicional continua limitada quando TestResults nao possuem environment,
  telemetria, notes, artifacts ou repeticoes.

## 2026-08-15 - O Lead desenha a validacao e CONTROL preserva a ladder completa

Decisao:

- o Lead Investigator devolve um `validationPlan` estruturado e validado, com
  hipotese, limite probatorio e somente recipes que o clone compiler suporta;
- LOW-BR deixa de ser o template universal. Diagnosticos de codec/audio group
  podem usar `representation_subset`, enquanto causas sem tratamento suportado
  ficam explicitamente sem plano automatico;
- CONTROL preserva todas as variants selecionadas da origem. O teto de seguranca
  passa de 8 para 32 e continua subordinado a duracao, bytes, recursos, SSRF e
  publish atomico;
- o limite de variants e aplicado depois da selecao do CloneSpec, permitindo que
  um treatment pequeno seja executado mesmo quando a origem possui uma ladder
  maior que o teto.
- HLS repete falhas transitorias no nivel de cada segmento antes de reiniciar o
  recording inteiro, alinhando sua recuperacao ao comportamento ja usado por
  DASH.

Motivo:

- uma origem valida com dez variants falhava antes do replay, embora a janela de
  120 segundos e o budget agregado fossem suficientes;
- usar sempre CONTROL + LOW-BR ignorava o diagnostico produzido pelos agentes e,
  no caso AAC/E-AC-3, testava uma variavel diferente da causa levantada.

Consequencias:

- o clone continua limitado e recuperavel, mas nao descarta arbitrariamente uma
  ladder comum de dez variants;
- hipoteses novas variam com a evidencia e o tratamento informa exatamente qual
  grupo foi removido ou isolado;
- reports antigos sem `validationPlan` usam apenas um fallback causalmente
  especifico quando a propria evidencia permite selecionar o grupo com seguranca.
