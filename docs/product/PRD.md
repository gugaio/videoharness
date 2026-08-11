# Product Requirements Document - Video Harness Space

Versao: MVP v1.1 - Investigate + Record HLS VOD

## Contexto

Video Harness Space e um workspace assistido por IA para investigar sistemas de
video streaming. O produto deve transmitir a sensacao de que uma equipe experiente
comecou a investigar o stream imediatamente depois do envio da URL.

O MVP nao pretende validar uma plataforma completa. Ele valida se engenheiros de
streaming encontram valor em investigacoes assistidas por IA e em experimentos
ABR reproduziveis sobre recordings limitados.

## Proposta

> Cursor for Streaming Engineers.

> Linear for Streaming Incidents.

O produto nao e apenas um dashboard, player ou wrapper de FFmpeg. Ferramentas
deterministicas coletam evidencias e a IA transforma essas evidencias em uma
investigacao compreensivel e acionavel.

## Workflows do MVP

```text
Investigate
  Paste URL + report symptom
    -> AI-assisted investigation
    -> Receive an excellent report

Record
  Paste HLS VOD URL
    -> Save a bounded multi-variant recording
    -> Create a playback run with a network profile
    -> Open the Video Harness URL on a device
    -> Observe request-level ABR switches
```

Entrada:

- URL de um stream.
- Descricao opcional do problema percebido.

Saida:

- Timeline viva da investigacao.
- Evidencias tecnicas auditaveis.
- `AbrAssessment` de HLS ou DASH em toda investigation, mesmo quando o sintoma
  relatado nao e ABR.
- Hipoteses e causa mais provavel.
- Recomendacoes acionaveis.
- Relatorio final compartilhavel.

Entrada Record R1:

- URL HLS VOD.
- Duracao/janela limitada.

Saida Record R1:

- recording persistido com ladder e cobertura;
- URL unica por playback run;
- profile de throughput/latencia aplicado;
- journal de requests por variant e sequence;
- resultado ABR `observed`, `not_observed` ou `inconclusive`.

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
- Record - available quando Record R1 atingir o primeiro slice end-to-end;
- Watch - coming soon;
- Replay - coming soon.

Investigate permanece a acao default. Durante a implementacao de R1, Record pode
aparecer como `in development`; depois do slice end-to-end, o card navega para o
fluxo dedicado.

## Record screen

- Intake simples com URL HLS VOD e duracao.
- Progresso real: validando, coletando manifests, gravando variants e publicando.
- Estado pronto mostra ladder, cobertura, bytes e limitacoes.
- CTA principal cria um playback run com preset ABR auditavel.
- URL possui acao clara de copiar e instrucao para abrir no device.
- Timeline mostra requests de media e mudancas de variant.
- Resultado distingue troca observada, sustentada, ausente e inconclusiva.
- A interface nunca apresenta request como prova de frame renderizado.

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
11. Criar recording HLS VOD recuperavel e limitado.
12. Materializar todas as variants suportadas e renditions necessarias.
13. Servir recursos gravados por URL opaca, sem fetch sob demanda.
14. Aplicar profiles deterministas de throughput e latencia por playback run.
15. Persistir requests e derivar trocas ABR no nivel de request.
16. Reutilizar o mesmo recording em multiplos experimentos.
17. Avaliar deterministicamente a ladder ABR em toda investigation e executar o
    especialista ABR sem depender de protocolo, fabricante, player ou resolucao
    especificos; o relato do usuario orienta apenas a prioridade.

## Requisitos nao funcionais

- Dark mode first e responsivo.
- TypeScript strict.
- PostgreSQL como fonte de verdade.
- Filesystem local com fronteira para storage futuro.
- Limites de rede, disco, tempo e concorrencia.
- Protecao SSRF para URLs arbitrarias.
- Pipeline recuperavel apos restart do worker.
- Deploy por Docker Compose em um VPS.
- URL de playback fixa por recording e acessivel ao device; o run ativo aplica
  shaping e grava o journal, e o clone continua servindo sem run ativo.
- Throughput compartilhado entre requests concorrentes do mesmo playback run.

## Fora do MVP

- Gravacao continua ou live em Record R1.
- Monitoramento 24/7.
- Replay de incidentes.
- Certificacao ou matriz ampla de compatibilidade em devices reais; smoke de
  playback em um device faz parte da validacao de Record.
- Colaboracao em equipe.
- Historico avancado e dashboards.
- Billing.
- Kubernetes, Redis ou broker de mensagens.
- DRM, LL-HLS, perda/reorder e emulacao de device.
- DASH Record antes da conclusao de HLS VOD; DASH VOD e Record R2.

## Definicao de sucesso

Um engenheiro envia uma URL e descreve um problema. A interface reage
imediatamente, evidencia trabalho real e termina com um relatorio que economiza
horas de investigacao. O usuario deve sair pensando: `This saved me hours.`

Para Record, um engenheiro grava uma janela HLS VOD, abre uma URL do Video Harness
em um device, aplica um profile de rede e obtem evidencia clara de quais variants
foram requisitadas antes, durante e depois da degradacao.
