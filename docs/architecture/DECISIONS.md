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
