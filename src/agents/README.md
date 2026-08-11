# Agents

Dominio de IA do Video Harness: a equipe de agentes que explica as evidencias
deterministicas coletadas pelo pipeline.

## Origem

Codigo novo deste repositorio, extraido do adapter
`src/investigation/adapters/pi-investigation-ai.ts` em 2026-08-08 para isolar o
core de agentes do detalhe de provider. Nenhuma dependencia de runtime de
`../kael` ou `../vhs`.

## Responsabilidades

- Roster fixo: tres especialistas (`timeline-playback`, `container-encoding`,
  `manifest-delivery`), o `abr-switch-investigator` focado em qualidade ABR e o
  `lead-investigator`.
- Prompts de especialista e de Lead, com contratos JSON explícitos.
- Validacao tolerante das respostas (confidence finita, findings individuais).
- Orquestracao: especialistas com fan-out limitado a duas chamadas concorrentes,
  retry com backoff e progresso real, depois sintese do Lead; falha de um agente
  nao esconde os demais nem o report deterministico.
- Port `AgentModelRunner` separa o core da equipe do provider LLM concreto.
- Auditoria serializavel de cada prompt enviado, incluindo retry, provider,
  modelo e ferramentas disponibilizadas; o registro nao armazena raciocinio
  interno do modelo.
- O especialista ABR recebe `AbrAssessment`: ladder e cobertura de HLS ou DASH,
  findings determinísticos, matriz e uma transicao prioritaria quando existe.
  Ele roda em toda investigacao; o problema relatado orienta prioridade sem
  restringir o baseline nem introduzir premissas de player/device.
- O candidato prioritario inclui resultados FFmpeg A/B/C e D quando o contrato
  permite; a IA nao executa nem constroi os comandos.

## Estrutura

```text
src/agents/
  domain/
    types.ts        # AiFinding, AiAgentRun, AiAgentProgress, AiInvestigationResult
    profiles.ts     # SPECIALIST_PROFILES + LEAD_AGENT_ID
    prompts.ts      # prompts gerais + ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT
    parsing.ts      # schemas Zod e parsers tolerantes
    errors.ts       # classificacao e mensagem publica de falhas
  ports/
    agent-model-runner.ts   # fronteira do provider LLM
  application/
    run-agent-team.ts       # orquestracao da equipe e resultado estruturado
    abr-quality-investigator-agent.ts # contrato JSON e pacote AbrAssessment
  adapters/
    pi-model-runner.ts      # implementacao Pi do AgentModelRunner
```

## Regra de dependencia

- `domain/` e `application/` nao importam SDKs de IA.
- `adapters/pi-model-runner.ts` concentra `@earendil-works/pi-agent-core` e
  `@earendil-works/pi-ai`; a fronteira entre core e Pi e o port
  `AgentModelRunner`.
- O fluxo de investigacao continua dependendo apenas do port
  `InvestigationAI` em `src/investigation/ports/`, que reexporta os tipos
  compartilhados do dominio.
