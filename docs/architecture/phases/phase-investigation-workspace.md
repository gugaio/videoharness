# Fase - Investigation Workspace

Status: **ativa**.

## Objetivo

Transformar Investigate de um pipeline que termina em report para um workspace de
evidencias e experimentos. A pessoa deve poder ver primeiro os fatos
deterministicos, abrir um chunk, entender o que cada agente recebeu e transformar
uma hipotese em um replay controlado.

## Primeiro corte entregue

- Workspace em tres etapas navegaveis: explorer deterministico, Diagnosis
  orientada pelo estado e Validate opcional. Durante a execucao Diagnosis mostra
  agentes/timeline; depois de `completed`, abre pelo report e recolhe a auditoria.
- O workspace usa uma superficie clara e continua sobre o shell escuro, mantendo
  os estados visuais em cards brancos e acentos semanticos discretos.
- Manifestos e a ladder declarada aparecem antes do report em linhas por
  representation. Chunks preservados ficam na propria linha e representacoes nao
  amostradas permanecem explicitamente vazias, sem fingir cobertura.
- O inspector transforma o probe em visualizacoes reais: lanes de PTS, mapa de
  GOPs, strokes I/P/B, random access fMP4 e detalhe clicavel de frame. Contagens e
  truncamento deixam claro quando o snapshot guarda apenas um resumo compacto.
- Prompt audit por agente fica no trilho lateral para selecao; o run completo
  (input packet, system prompt, tool calls e output validado) abre no conteudo
  principal, tanto durante a execucao quanto no painel `Agent panel` aberto por
  padrao depois da conclusao.
- Perguntas do usuario sao atividades persistidas do caso; nao fingem acionar um
  agente automaticamente.
- Validate integra Experiments na mesma superficie clara, deriva o contexto da
  causa provavel e persiste uma hipotese real separada dos findings do report. O
  Lead entrega um `validationPlan` especifico; CONTROL preserva a ladder inteira
  e o unico treatment muda a variavel compativel com o diagnostico, sem usar
  LOW-BR como template universal. Experiments continuam sendo o mecanismo para
  gerar URL estavel e coletar um resultado estruturado no device.
- Depois dos TestResults, Validate cria um job recuperavel de avaliacao. Um
  guardrail deterministico limita o alcance causal e tres agentes em serie
  (Evidence Auditor, Causal Analyst e Lead Experiment Investigator) produzem a
  interpretacao, alternativas, limites e proximo teste. O efeito discriminante
  de um unico tratamento e `PARTIALLY_SUPPORTED`, nunca prova automaticamente a
  causa mais ampla copiada do report.
- Cada coleta publica um `evidence_snapshot` imutavel. Prompt, tool calls e output
  validado de cada agente ficam em `agent_runs`, fora do report compartilhavel.
- O job de coleta termina em `evidence_ready`. Um segundo job de analise so existe
  depois de `POST /analysis`, preservando a fronteira entre fatos e interpretacao.
- As chamadas de agentes usam a credencial compartilhada em serie, com pacote
  inicial compacto e detalhes de frame/NAL sob inspecao explicita. O boundary
  normaliza variacoes seguras do JSON e aplica backoff distinto para rate limit,
  sem aceitar findings sem evidence IDs validos.
- Cada especialista recebe somente sua pista citavel (timeline, container ou
  manifest/delivery), alem de um resumo ABR deterministico anti-eco. O audit
  persiste bytes de input, fatos citaveis e sobreposicao de IDs entre pistas;
  findings fora da pista sao descartados antes da sintese do Lead.

## Ajuste: persistencia em arquivos JSON/JSONL

- O PostgreSQL foi eliminado. Toda persistencia usa arquivos locais JSON/JSONL
  atras de `src/store/` (`JsonStore`), compartilhados por API, worker e UI.
- Jobs continuam recuperaveis (claim, lease e heartbeat) via locks de diretorio e
  arquivos JSON; eventos de SSE seguem monotonicos via contador de sequencia.
- O health endpoint reporta `storage` em vez de `database`.

## Proximos cortes

1. Persistir Hypothesis no nivel da investigation.
2. Fazer uma pergunta criar um novo AgentRun explicito sobre um snapshot escolhido.
3. Correlacionar TestResults com playback runs/journal atribuidos para que a
   equipe pos-experimento receba telemetria alem do relato manual.

## Definition of Done da fase

- A pessoa consegue abrir uma investigation e compreender a ladder e os chunks
  sem depender da IA.
- Cada agent run referencia uma revisao imutavel de evidencia, seu prompt e output
  validado, sem armazenar chain of thought.
- Uma hipotese pode gerar um test plan e a URL estavel do device retorna como nova
  evidencia para o Lead.
