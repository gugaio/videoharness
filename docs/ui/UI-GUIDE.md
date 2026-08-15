# UI Guide - Video Harness Space

## Objetivo emocional

O usuario deve sentir que uma equipe experiente comecou a investigar imediatamente
ou que um laboratorio controlado ficou pronto para reproduzir o stream. A
interface vende confianca, clareza e velocidade, nao densidade tecnica.

## Direcao visual

- Shell dark-first; o workspace de investigacao e uma superficie clara dentro
  dessa moldura.
- Grande uso de espaco negativo.
- Tipografia forte e legivel.
- Superficies com bordas discretas e contraste leve entre pagina, cards e estados.
- Um unico accent frio e estados semanticos contidos.
- Motion suave, curto e funcional.
- Referencias: Linear, Raycast, Vercel, Arc e Apple.

Referencia visual inicial local:

`/home/gugaime/Pictures/vhs.png`

Para a estrutura e o tom visual do workspace de investigacao:

`/home/gugaime/IA/vhsdesign`

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

Investigate permanece o fluxo default. O card Investigate agora navega para a
lista de cases (`/investigations`), onde a pessoa abre ou apaga investigations;
o formulario da home continua criando um caso novo. Record esta interativo e
navega para `/record`; Watch e Replay continuam inativos.

### Pagina de investigations

Rota `/investigations`, com o mesmo shell dark-first:

- Lista as investigations da mais recente para a mais antiga, com stream
  (sourceUrl truncada), descricao do problema, estado e data de criacao.
- `Open` abre o caso; `Delete` pede confirmacao (`Confirm`) antes de apagar.
- A delecao remove o caso no banco e tambem os arquivos de artifacts, o
  workspace lab e os workspaces/recordings de experiments vinculados; uma
  falha de filesystem nao impede a delecao confirmada no banco.
- O estado e recarregado a cada poucos segundos e o health continua discreto.

### Estado implementado

- Shell dark-first e responsivo em React/Vite.
- Hero, URL, problem description e quatro cards de modulos.
- Health discreto conectado a `/v1/health`.
- CTA envia URL e problem description para a API e navega imediatamente para o
  caso criado.
- Somente a URL e obrigatoria. A descricao aceita sintomas e, quando existirem,
  modelo/firmware e trechos de log de qualquer player; a ajuda deixa claro que
  esses dados permanecem contexto relatado, nao telemetria medida.
- Pagina de lista em `/investigations` com abrir/apagar; card Investigate leva
  para ela.
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
- A mesma tela oferece um smoke explícito no browser: hls.js para HLS e dash.js
  para DASH. O player nunca inicia sozinho e seus requests participam do profile
  e do journal do run ativo.
- Antes de baixar segmentos DASH, a UI consulta o MPD local e testa os codecs
  declarados com `MediaSource.isTypeSupported`. Codec recusado pelo browser vira
  estado `Unsupported`, sem ser confundido com CORS nem com falha do recording.
- A tela declara as limitacoes atuais; o journal mostra selecao de rede real e a
  evidencia correlacionada de switch fica disponivel no control plane sem fingir
  decode/render ou eventos de player ausentes.

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
- A URL de playback e fixa por recording; iniciar ou encerrar um teste nunca
  gera outra URL. A tela deve deixar isso explicito.
- Sem run ativo, a URL ainda serve o clone com o perfil baseline; o shaping so
  vale enquanto um run estiver aberto.
- Um CTA explicito `Stop test run` encerra o run e congela o resumo; a URL
  permanece servindo o recording.
- Ao recarregar a rota do recording, a tela consulta o último run aberto e
  restaura seu perfil e journal; ela não volta a oferecer `Start` enquanto
  esse run existir.
- O card `Play this recording here` inicia somente por CTA. Ele comunica estados
  checking, ready, playing, buffering, unsupported e error, mostra o resultado
  MSE por codec e permite parar/reiniciar sem mudar a URL do recording.
- A checagem MSE comprova somente que o browser aceita criar o pipeline daquele
  codec; nao comprova decode em hardware nem frames renderizados.

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

### Direcao atual: workspace de investigacao

- O workspace forma uma folha clara e continua sobre o shell escuro: fundo cinza
  muito suave, cards brancos, texto grafite e acentos violetas, azuis e mint. Evitar
  paineis escuros aninhados dentro dessa superficie.
- A navegacao do workspace possui tres etapas persistidas na URL: `Stream data`
  (`view` ausente), `Diagnosis` (`?view=analysis`) e `Validate`
  (`?view=validate`). Voltar para uma etapa anterior nunca descarta report,
  auditoria ou experimentos; `Validate` e explicitamente opcional.
- A etapa 1 usa a largura inteira somente para fatos deterministas. Nao mostra
  agentes, prompt audit, timeline de IA ou hipoteses.
- Ao final da etapa 1, um CTA cria o job real de analise. Antes de
  `evidence_ready`, `Diagnosis` permanece bloqueada; depois do clique ela fica
  navegavel durante e apos a execucao. `Validate` so abre quando existe report.
- `Diagnosis` e orientada pelo estado: durante a execucao, agentes e timeline
  ocupam a superficie principal; depois de `completed`, o report abre primeiro e
  o painel `Agent panel` fica abaixo dele, aberto por padrao, com o input packet,
  system prompt, tool calls e output validado de cada agente.
- O painel de agentes usa o trilho lateral para selecionar o especialista e o
  conteudo principal para o run persistido: todas as tentativas com `Attempt N`,
  provider/modelo e estado, `Input · evidence packet`, `System prompt`, tools
  disponiveis, tool calls (input e resultado) e `Validated output`. A auditoria
  nunca inclui chain of thought e nao faz parte do report compartilhavel.
- Para o especialista `manifest-delivery`, o painel extrai do input packet uma
  secao `Manifest content sent inline` com o texto cru de cada manifest por
  logicalKey, provando o que o agente recebeu; runs historicos sem o campo
  mostram uma limitacao explicita pedindo reanalise.
- A primeira superficie depois do header e o explorer deterministico: manifestos,
  ladder e chunks preservados. Clicar em um chunk revela somente GOP/fMP4, PTS/DTS,
  tracks e frames que foram medidos.
- O explorer tambem apresenta os fatos determinísticos novos de forma dedicada:
  `Delivery facts` (latencia, first-byte, redirects e headers por manifest),
  `Ladder alignment` (topologia declarada por variant, com badges de
  target-duration/discontinuity e marcacao de variants amostradas),
  `Timeline continuity` (gaps/overlaps de apresentacao entre chunks contiguos),
  `Observed playback switches` (transicoes ABR request-level do Record, quando
  presentes) e, no header, o decoder requerido pela ladder e badges de DRM.
- O inspector de chunk ganha `Container structure · MPEG-TS` (sync, PAT/PMT/PCR,
  continuities, truncamento) e `Delivery · this chunk` (latencia, first-byte,
  redirects, server/cache). Tudo opcional e somente quando medido.
- A ladder usa uma linha por representation declarada. Chunks preservados vivem
  na propria linha, com sequence/duracao e cobertura `preservado/declarado` quando
  o manifest fornece a contagem. Uma linha vazia significa `nao amostrada`, nunca
  `sem chunks na origem`.
- O header conta media chunks e INITs separadamente; INIT nunca infla a quantidade
  apresentada como chunk inspecionado.
- O inspector selecionavel segue o mock `vhsdesign`: timing e lanes A/V no topo,
  grupos GOP no centro e frames como strokes com altura/cor por I/P/B ou random
  access. Clicar em um GOP abre seus frames; clicar em um frame mostra PTS, DTS,
  duracao e sinalizacao de key/sync. Dados ausentes aparecem como ausentes.
- A timeline mostra atividades reais. O composer se chama
  `Question for the next analysis`, deixa claro que apenas persiste a pergunta e
  nao simula uma resposta nem contata um modelo naquele momento.
- Findings de report nunca sao rotulados como hipoteses. Uma hipotese passa a
  existir somente em `Validate`, quando e persistida no Experiment e ligada a um
  plano CONTROL/treatment.

- Navegar para o caso imediatamente depois do POST.
- Mostrar primeiro evento persistido sem esperar o worker.
- Timeline cronologica com ator, observacao, estado e timestamp.
- Atividade atual animada discretamente.
- Evidence details por progressive disclosure.
- Conclusao do Lead ganha hierarquia sem apagar especialistas.

### Estado implementado

- A rota usa o workspace como experiencia principal. Enquanto os agentes rodam,
  a timeline explica o trabalho real; depois de `completed`, o report vira a
  primeira superficie de `Diagnosis`.
- O explorer deterministico foi separado em um componente dedicado para manter o
  workspace como orquestrador simples de evidencia, diagnostico, auditoria e
  validacao.
- Coleta e IA sao etapas reais: a coleta termina em `evidence_ready`; o CTA
  `Start agent analysis` chama `POST /v1/investigations/:id/analysis` e abre a
  segunda etapa. Report e Validate aparecem somente depois dessa analise.
- A etapa `Diagnosis` termina com o report final persistido dentro da mesma
  superficie clara do workspace. A conclusao apresenta summary, confianca, causa
  provavel, recomendacoes, findings ligados a evidencia, checks deterministicos
  e limitacoes; o painel de agentes abaixo do report e a timeline ficam sob
  progressive disclosure, com o painel de agentes aberto por padrao.
- Carregamento e falha da consulta do report possuem estados visiveis. Uma falha
  de contrato ou transporte nao pode desaparecer como uma area vazia depois de
  `completed`.
- Antes da primeira evidencia existir, a etapa `Stream data` abre com uma
  composicao de investigacao em andamento, nao com um placeholder tecnico: o
  titulo e a atividade atual acompanham o estado persistido/SSE, quatro marcos
  explicam o passe (`source`, stream map, media e inspection), e o problema
  relatado permanece visivel. Checkmarks e atividade derivam somente de eventos
  reais; nao ha percentual, prazo ou progresso estimado.

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
  (Pip, Coda, Mara, Iris e Lead) com estados reais
  waiting/analyzing/done/failed derivados dos eventos `ai_agent`. Iris avalia
  qualidade ABR em toda investigation HLS/DASH; o total real e 5.
  Eventos `started` alimentam somente o checklist; conclusoes e falhas viram
  posts na timeline com a persona do especialista.
- Durante `collecting`, a abertura mostra o passo atual (ex.: "Sampling media
  sample 2 of 3…") e avanca os quatro marcos somente a partir de
  `collectionStage`. Os eventos de coleta nao viram posts individuais; o
  milestone `evidence_found` abre o explorer com o que foi preservado.
- Contadores de sample continuam locais a cada representation (`2 of 3`) dentro
  da mensagem real emitida pelo worker, e o segmento de origem permanece
  separado. Timeout vira coverage limitation e nao regride a composicao para
  `Validating` quando o manifest ja foi validado.
- Durante a coleta, limitations aparecem de forma contida e informam que as
  verificacoes restantes continuam. Os detalhes tecnicos ficam na evidencia
  preservada, sem revelar a URL assinada da origem.

### Experiments na Investigation

- Experiments vive como a etapa opcional `Validate`, dentro da mesma superficie
  clara e da mesma navegacao do workspace; nao aparece como um produto escuro e
  desconectado depois do report.
- A etapa recebe do Lead Investigator um `validationPlan` estruturado com
  hipotese falsificavel, recipe suportada, IDs exatos e fronteira do que o teste
  pode provar. LOW-BR so aparece quando pressao de entrega e de fato o mecanismo
  diagnosticado.
- O plano inicial continua pequeno: CONTROL com toda a ladder suportada mais um
  treatment causalmente especifico, como `AAC-ONLY`, um subconjunto de
  representations ou uma representation isolada.
- A UI explicita a fronteira particular de cada comparacao; nenhuma mudanca de
  manifest comprova decode/render ou mecanismo interno sem resultado atribuido
  do device.
- Hypothesis e environment ficam visiveis; goal e rationale permanecem editaveis
  por progressive disclosure, sem abrir a experiencia com um formulario generico.
- Assim que clones passam na verificacao, a secao mostra uma unica URL permanente
  do Experiment. Essa URL e copiada uma vez para o device e nunca muda entre
  CONTROL, treatments ou iteracoes.
- Cada card mostra label curta, CONTROL/TREATMENT, estado real do worker,
  `What changed`, hipotese, discriminating signal e provenance avancada.
- Os cards existem desde a fila: antes do TestRequest, mostram `QUEUED`,
  `BUILDING`, `VERIFYING` ou `FAILED`, a mudanca planejada e a explicacao do
  trabalho atual. Selecao e registro de resultado aparecem somente depois de
  `READY`, sem esconder quais tratamentos estao sendo preparados.
- Se a criacao interromper depois de persistir o Experiment, `DRAFT` e
  `PLANNED` mostram uma acao de continuacao idempotente no nivel da UX. `DRAFT`
  nunca e descrito como clone em build: a tela diferencia plano nao salvo,
  plano salvo, fila/build/verificacao e falha.
- `Select this treatment` muda o conteudo servido pela URL permanente. Somente o
  card selecionado habilita `Works`, `Fails`, `Inconclusive` ou `Unable to test`;
  a ordem visivel e selecionar, reproduzir novamente e registrar.
- Falha abre stage estruturado (manifest, startup, video, audio, DRM, stall, ABR,
  seek, A/V sync, subtitles ou other) e notes opcionais. Nenhum resultado e
  inferido do manifest, metadata ou ausencia de clique.
- Progresso usa contagens reais da iteracao (`N clones`, `X/N tested`). Quando
  todos os requests possuem resultado, a UI habilita `Analyze results with
  agents`.
- A avaliacao mostra o job persistido e a equipe real em ordem: Evidence Auditor,
  Causal Analyst e Lead Experiment Investigator. Nao usa spinner ou percentual;
  status e tentativa vem de `evaluationJob`.
- O resultado abre por `What was observed` e separa `What this supports`,
  interpretacao, `What this does not establish`, explicacoes alternativas,
  limitacoes, confianca e um unico proximo teste discriminante.
- Depois que existe evaluation, a sintese aparece antes dos cards CONTROL e
  treatment; esses resultados/provenance ficam recolhidos em `Observed test
  evidence`. O formulario de uma nova validacao tambem fica fechado para nao
  empurrar a conclusao para baixo da pagina.
- Cada AgentRun mostra `COMPLETED`, `FAILED` ou `UNAVAILABLE` e somente seu
  summary/limitation estruturado. O painel `Agent panel` do workspace expoe o
  input packet e o system prompt de cada chamada persistida; chain of thought e
  prompt bruto de raciocinio nao entram na experiencia principal.
- Avaliacoes antigas sem `analysis` recebem o rotulo `Legacy rule-only
  evaluation` e um CTA real de reanalise. Em `FOLLOWUP_REQUIRED`, a UI pode criar
  uma iteracao focada, preservando todo o historico anterior.
- Environments salvos podem ser reutilizados e ficam associados ao Experiment e
  aos TestResults. QR code nao foi adicionado porque o repositorio nao possuia
  dependencia e copiar a URL unica atende ao fluxo com menor superficie.

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
- Cada card da equipe com uma chamada concluida oferece `View prompt & evidence
  sent` por progressive disclosure. O painel mostra system prompt, pacote de
  analise/evidencia, provider/modelo, tentativas e ferramentas disponibilizadas;
  ele nunca mostra raciocinio interno do modelo e nao faz parte de reports
  compartilhados.
- Masters HLS exibem um finding adicional com a variant representativa selecionada
  e o numero real de manifests preservados; a regra de selecao nao e apresentada
  como root cause.
- Todo report novo mostra `ABR quality` logo apos o verdict: protocolo, verdict
  limitado pela cobertura, ladder, samples, transicoes analisadas, findings
  determinísticos e proximas medicoes. O bloco existe mesmo sem problema ABR
  relatado.
- Em DASH, o mesmo bloco acrescenta cards de `AbrSwitchEvidence` com provenance,
  INIT semantic diff, SAP/IRAP, timeline e rule IDs. Candidatos URL-only ficam
  rotulados como nao observados; contexto de player/device relatado nunca vira
  telemetria. Reports antigos sem `AbrAssessment` usam o painel DASH legado.

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
