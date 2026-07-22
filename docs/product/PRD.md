# Product Requirements Document - Video Harness Space

Versao: MVP v1.0

## Contexto

Video Harness Space e um workspace assistido por IA para investigar sistemas de
video streaming. O produto deve transmitir a sensacao de que uma equipe experiente
comecou a investigar o stream imediatamente depois do envio da URL.

O MVP nao pretende validar uma plataforma completa. Ele valida se engenheiros de
streaming encontram valor em investigacoes assistidas por IA.

## Proposta

> Cursor for Streaming Engineers.

> Linear for Streaming Incidents.

O produto nao e apenas um dashboard, player ou wrapper de FFmpeg. Ferramentas
deterministicas coletam evidencias e a IA transforma essas evidencias em uma
investigacao compreensivel e acionavel.

## Workflow do MVP

```text
Paste URL
   -> AI investigates
   -> Receive an excellent report
```

Entrada:

- URL de um stream.
- Descricao opcional do problema percebido.

Saida:

- Timeline viva da investigacao.
- Evidencias tecnicas auditaveis.
- Hipoteses e causa mais provavel.
- Recomendacoes acionaveis.
- Relatorio final compartilhavel.

## Principios de produto

1. Simplicidade e UX vencem quantidade de features.
2. O produto vende confianca e produtividade de engenharia.
3. Analise tecnica deve ser deterministica sempre que possivel.
4. O LLM nao inventa medidas nem substitui ferramentas de midia.
5. A interface mostra vida, progresso real e evidencias; nunca chain of thought.
6. O custo deve ser adequado a poucos usuarios em um unico VPS.

## Homepage

A homepage tem uma acao dominante:

- titulo: `Investigate any streaming issue.`
- subtitulo explicando a equipe de especialistas;
- campo de URL;
- descricao opcional do problema;
- botao `Investigate`.

Cards de visao:

- Investigate - available;
- Record - coming soon;
- Watch - coming soon;
- Replay - coming soon.

Os cards futuros nao possuem funcionalidade no MVP.

## Investigation screen

A tela mostra eventos reais, por exemplo:

- URL validated;
- manifest detected;
- renditions discovered;
- downloading media;
- inspecting timestamps;
- checking HTTP responses;
- comparing codecs;
- generating report.

Especialistas apresentados ao usuario:

- Playback;
- Media;
- Network;
- Compatibility;
- Lead Investigator.

As personas sao uma camada de produto. O runtime pode usar um unico orquestrador
ou combinar ferramentas deterministicas e chamadas de IA conforme custo e valor.

## Report

Secoes esperadas:

- Summary;
- Problem reported;
- Evidence;
- Technical findings;
- Hypotheses;
- Root cause;
- Recommendations;
- Artifacts;
- Confidence;
- Limitations.

## Requisitos funcionais

1. Criar e persistir investigacao.
2. Enfileirar e executar job recuperavel.
3. Validar e inspecionar URL de streaming.
4. Coletar evidencias deterministicas.
5. Persistir eventos de investigacao.
6. Transmitir eventos por SSE e restaurar historico na reconexao.
7. Gerar sintese baseada nas evidencias.
8. Persistir e exibir relatorio.
9. Preservar somente artifacts relevantes.
10. Limpar arquivos temporarios.

## Requisitos nao funcionais

- Dark mode first e responsivo.
- TypeScript strict.
- PostgreSQL como fonte de verdade.
- Filesystem local com fronteira para storage futuro.
- Limites de rede, disco, tempo e concorrencia.
- Protecao SSRF para URLs arbitrarias.
- Pipeline recuperavel apos restart do worker.
- Deploy por Docker Compose em um VPS.

## Fora do MVP

- Gravacao continua.
- Monitoramento 24/7.
- Replay de incidentes.
- Compatibilidade testada em devices reais.
- Colaboracao em equipe.
- Historico avancado e dashboards.
- Billing.
- Kubernetes, Redis ou broker de mensagens.

## Definicao de sucesso

Um engenheiro envia uma URL e descreve um problema. A interface reage
imediatamente, evidencia trabalho real e termina com um relatorio que economiza
horas de investigacao. O usuario deve sair pensando: `This saved me hours.`

