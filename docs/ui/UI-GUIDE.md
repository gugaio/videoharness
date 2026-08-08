# UI Guide - Video Harness Space

## Objetivo emocional

O usuario deve sentir que uma equipe experiente comecou a investigar imediatamente
ou que um laboratorio controlado ficou pronto para reproduzir o stream. A
interface vende confianca, clareza e velocidade, nao densidade tecnica.

## Direcao visual

- Dark mode first.
- Grande uso de espaco negativo.
- Tipografia forte e legivel.
- Superficies escuras com bordas discretas.
- Um unico accent frio e estados semanticos contidos.
- Motion suave, curto e funcional.
- Referencias: Linear, Raycast, Vercel, Arc e Apple.

Referencia visual inicial local:

`/home/gugaime/Pictures/vhs.png`

O chrome de navegador presente no mockup e apenas moldura de apresentacao, nao faz
parte da interface do site.

## Homepage

Uma dobra principal, sem navegacao competitiva:

1. Brand discreta.
2. Headline central.
3. Subtitle.
4. URL input dominante.
5. Problem description opcional.
6. CTA `Investigate`.
7. Cards Investigate, Record, Watch e Replay.

Investigate permanece o fluxo default. Record esta interativo e navega para
`/record`; Watch e Replay continuam inativos.

### Estado implementado

- Shell dark-first e responsivo em React/Vite.
- Hero, URL, problem description e quatro cards de modulos.
- Health discreto conectado a `/v1/health`.
- CTA envia URL e problem description para a API e navega imediatamente para o
  caso criado.
- Background abstrato foi feito em CSS, sem depender de asset externo.

## Record

Record e um fluxo dedicado, nao uma opcao escondida no formulario de Investigate.

### Estado implementado

- Card Record na homepage com estado `Available now` e navegacao para `/record`.
- Intake HLS ou DASH VOD com seletor explicito, URL, janela de 30--600 segundos
  e CTA `Record stream`.
- Tela `/recordings/:recordingId` consulta o estado, recebe eventos persistidos
  por SSE, mostra cobertura/bytes e nunca oferece run durante falha ou coleta.
- Quando `ready`, o preset `Good -> constrained -> recovery` cria o playback run
  e permite copiar sua URL local para o device.
- A tela declara as limitacoes atuais de R1; ela nao inventa evidencias ABR
  enquanto journal e inferencia nao existem.

### Intake

- Rota `/record`.
- URL VOD como campo dominante e seletor de protocolo explicito; HLS e o default.
- Duracao da janela com default de 120 segundos e limites visiveis.
- Toda a ladder suportada e gravada; nao expor checkbox `all variants` no primeiro
  corte porque ele e uma invariante do teste ABR.
- CTA unico `Record stream`.
- Explicar antes do envio os limites: HLS clear/MPEG-TS ou DASH static clear/fMP4
  com SegmentTemplate; live, DRM e byte ranges nao sao aceitos.

### Recording screen

- Rota `/recordings/:recordingId` aberta imediatamente depois do POST.
- Progresso somente por eventos persistidos: URL validada, master encontrada,
  ladder descoberta, variant sendo gravada, janela alinhada e origin publicado.
- Estado `ready` prioriza ladder, cobertura efetiva, bytes e limitacoes.
- Falha parcial nunca oferece uma URL possivelmente inconsistente.

### Playback run

- O recording pronto oferece duas acoes: `Start normal` (controle, 100 Mbps e
  zero latencia artificial) e `Force ABR`.
- Para DASH, ha tambem `1080p control`: cria um run normal cuja mesma URL fixa
  entrega somente a 1080p de maior bitrate e o audio, removendo ABR de video.
- `Force ABR` usa `Good -> constrained -> recovery`, com valores reais de kbps
  e latencia visiveis antes da criacao (stepper com os 3 stages do plano).
- Depois da criacao, mostrar a URL completa com acao `Copy playback URL` e uma
  instrucao curta para abri-la no device.
- A URL copiada preserva a origem pela qual a tela foi aberta. Para um device na
  LAN, abra o Harness pelo IP/DNS da maquina, nunca por `localhost`.
- A URL e unica por run; criar outro teste gera outra URL.
- Enquanto o modo de laboratorio estiver ativo, a URL exposta e fixa
  (`/streams/fixed/...`) e aponta para o run valido criado mais recentemente.
- Um CTA explicito `Finish test` encerra a janela e congela o resumo.

### Recording screen (dashboard)

- Tela no estilo dashboard com KPIs em cards: janela solicitada, cobertura
  efetiva, bytes armazenados e protocolo.
- Quando um playback run existe, uma seccao `ABR evidence` mostra KPIs
  derivados dos requests (total, video picks, latencia media, banda media) mais
  a contagem real de trocas de variant observadas no journal.
- Graficos em SVG nativo (sem biblioteca nova), sempre alimentados por dados
  reais do journal de delivery - nunca por progresso ficticio:
  - `Bandwidth vs representation`: banda modelada (rede) sobreposta a selecao
    de representacao do player (pontos), com faixas por stage (Good /
    Constrained / Recovery).
  - `Served latency`: barras por request com cor por magnitude.
- O plano de shaping usa os stages reais do playback run (preset antes da
  criacao; run.profile depois), mantendo os valores de kbps/latencia visiveis.

### Request evidence

- Timeline ao vivo agrupa manifest, video, audio e erro sem despejar logs brutos.
- Cada request de video mostra tempo relativo, sequence, bitrate, resolucao,
  throughput observado e stage aplicado.
- Trocas ganham marcadores `Downshift requested`, `Upshift requested` ou
  `Variant change requested`.
- `Sustained` exige dois chunks posteriores consecutivos na nova variant.
- Resultado final usa `Observed`, `Not observed` ou `Inconclusive` e explica a
  cobertura.
- Texto permanente informa que requests comprovam selecao de rede, nao frame
  decodificado/renderizado.

### Responsividade de Record

- Desktop pode usar duas colunas: ladder/profile e timeline.
- Mobile usa uma coluna, URL quebravel/copiante e cards de request sem tabela
  horizontal.
- A timeline limita itens visiveis e oferece progressive disclosure para o
  journal completo.

## Investigation screen

- Navegar para o caso imediatamente depois do POST.
- Mostrar primeiro evento persistido sem esperar o worker.
- Timeline cronologica com ator, observacao, estado e timestamp.
- Atividade atual animada discretamente.
- Evidence details por progressive disclosure.
- Conclusao do Lead ganha hierarquia sem apagar especialistas.

### Estado implementado

- Rota `/investigations/:investigationId`.
- Header do caso com URL, problema e estado persistido.
- Indicador de conexao SSE.
- Timeline restaurada a partir dos eventos append-only.
- Dedupe de eventos por ID durante reconexao.
- Estados de opening, erro e timeline vazia.
- Estado do caso atualizado enquanto o worker executa.
- Conclusao e report fixture apresentados sem esconder que a analise real ainda
  nao foi executada.
- Durante `analyzing`, o card de trabalho mostra o checklist vivo da equipe de IA
  (Pip, Coda, Mara e Lead) com estados reais waiting/analyzing/done/failed
  derivados dos eventos `ai_agent`, alem do contador "N of 4 analyses complete".
  Eventos `started` alimentam somente o checklist; conclusoes e falhas viram
  posts na timeline com a persona do especialista.

Proibido:

- chain of thought;
- progresso percentual inventado;
- spinner de pagina inteira durante o pipeline;
- logs brutos como experiencia principal;
- jargao sem explicacao no summary.

## Report

Ordem visual sugerida:

1. Summary e confidence.
2. Root cause.
3. Recommendations.
4. Evidence e technical findings.
5. Hypotheses e contradictions.
6. Artifacts e limitations.

O report deve funcionar como pagina compartilhavel e como documento de engenharia.

### Estado implementado

- A tela do caso consulta o report quando a investigation chega a `completed`.
- A fixture da Fase 1 possui hierarquia visual propria e rotulo explicito de
  placeholder tecnico.
- Confidence permanece `not_assessed`; a UI nao inventa root cause ou evidencia.
- Reports da Fase 2 sao identificados como `Deterministic evidence report` e
  `Observed evidence`. A amostra de media adiciona findings de codecs/tracks sem
  apresentar a selecao limitada como causa raiz; confidence permanece `limited`.
- Quando configurado, o Lead Investigator aparece como uma camada separada sobre
  a evidencia deterministica, com causa provavel e proximos passos auditaveis.
- Masters HLS exibem um finding adicional com a variant representativa selecionada
  e o numero real de manifests preservados; a regra de selecao nao e apresentada
  como root cause.
- Reports DASH mostram a ladder de video e uma matriz de fronteiras candidatas.
  O bloco deixa claro quando a janela veio do relato do usuario e quando a matriz
  possui somente resultado estrutural, sem telemetria de player ou Tizen.

## Responsividade

- Desktop: conteudo central e painel auxiliar apenas se trouxer contexto.
- Tablet: uma coluna principal com anexos abaixo.
- Mobile: timeline em uma coluna, targets de toque e sem tabelas horizontais
  obrigatorias.

## Estados obrigatorios

- vazio;
- envio pendente;
- queued;
- coletando;
- analisando;
- sintetizando;
- concluido;
- falho recuperavel;
- falho definitivo;
- SSE desconectado/reconectando.
- recording queued/validating/collecting/ready/failed;
- playback run created/active/completed/expired/failed;
- ladder sem duas variants;
- nenhuma troca observada;
- evidencia inconclusiva por cobertura insuficiente.

## Ritual de atualizacao

Mudancas de direcao, novos estados ou alteracoes relevantes no fluxo principal
devem ser registradas aqui e no status da fase ativa.
# Playback validation

Depois do report, a pagina oferece uma validacao opcional e explicitamente
acionada. O video tem controles nativos, CTA unico e comunica que a origem HLS
precisa permitir CORS. Enquanto a revisao assincrona ocorre, o report atual segue
visivel; ao receber SSE ele atualiza sem recarregar a pagina.
