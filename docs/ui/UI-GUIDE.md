# UI Guide - Video Harness Space

## Objetivo emocional

O usuario deve sentir que uma equipe experiente comecou a investigar imediatamente.
A interface vende confianca, clareza e velocidade, nao densidade tecnica.

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

Somente Investigate e interativo.

### Estado implementado

- Shell dark-first e responsivo em React/Vite.
- Hero, URL, problem description e quatro cards de modulos.
- Health discreto conectado a `/v1/health`.
- CTA envia URL e problem description para a API e navega imediatamente para o
  caso criado.
- Background abstrato foi feito em CSS, sem depender de asset externo.

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
- Reports da Fase 2 sao identificados como `Deterministic manifest report` e
  `Observed evidence`, mantendo confidence `limited` enquanto segmentos e media
  ainda nao foram analisados.
- Masters HLS exibem um finding adicional com a variant representativa selecionada
  e o numero real de manifests preservados; a regra de selecao nao e apresentada
  como root cause.

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

## Ritual de atualizacao

Mudancas de direcao, novos estados ou alteracoes relevantes no fluxo principal
devem ser registradas aqui e no status da fase ativa.
