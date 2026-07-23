# Fase 3 - Investigacao Assistida por IA

Status: **em andamento junto ao corte HLS MPEG-TS do MVP**

## Objetivo

Transformar evidencias deterministicas em hipoteses, explicacao e recomendacoes
auditaveis.

## Escopo

- Runtime Pi isolado por um port de IA, sem chat, shell, browser, memoria ou MCP.
- Especialistas de timeline/playback, container/encoding e manifest/delivery.
- Lead Investigator.
- Outputs estruturados e validados.
- Normalizacao conservadora de campos escalares nao finitos sem descartar a
  resposta inteira.
- Findings malformados isoladamente nao invalidam summaries e findings validos
  do mesmo especialista.
- Citacao de evidence IDs.
- Confianca limitada por contradicoes e evidencia ausente.
- Persistencia do report e identificacao versionada dos prompts relevantes.
- Logs seguros por tentativa registram agente, provider, modelo, status HTTP,
  duracao e categoria de falha, sem prompts, respostas brutas ou segredos.

## Definition of Done

- Report cita evidencias existentes.
- Nenhum finding inventa medida tecnica.
- Falha de um especialista nao invalida automaticamente toda investigacao.
- Fixtures possuem avaliacao minima de qualidade e regressao.

## Validacao real

Em 2026-07-23, a investigation
`3143d345-81ae-4fd4-befe-37a46f37d9a4` foi executada via Docker Compose contra
`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`.

- Os tres especialistas concluiram.
- O Lead Investigator concluiu.
- O provider respondeu HTTP 200.
- O report persistiu causa provavel, confidence, findings com evidence IDs,
  recomendacoes e limitacoes.
- Uma falha transitoria do especialista de manifest/delivery foi recuperada no
  segundo attempt.
