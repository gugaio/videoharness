# Fase 1 - Thin Slice Persistente

Status: **concluida**

## Objetivo

Validar a arquitetura completa com comportamento placeholder antes de importar as
ferramentas complexas.

## Fluxo

```text
Formulario -> API -> Postgres job -> Worker -> events -> SSE -> report placeholder
```

## Escopo

- [x] Migration inicial com investigations, jobs, events, artifacts e reports.
- [x] Entry points separados para API e worker.
- [x] Health real da API e PostgreSQL.
- [x] UI React/Vite inicial com direcao visual do produto.
- [x] Contratos iniciais de investigation e intake.
- [x] Repository PostgreSQL explicito para intake.
- [x] Criacao idempotente de investigation, job e evento na mesma transacao.
- [x] Worker com claim, lease e heartbeat.
- [x] State machine minima.
- [x] Consulta do caso persistido.
- [x] SSE com historico e `Last-Event-ID`.
- [x] Homepage e primeira tela de investigacao funcionais.
- [x] Report placeholder explicitamente identificado como fixture tecnica.

## Implementacao final

O lifecycle placeholder foi fechado com:

1. claim transacional com `FOR UPDATE SKIP LOCKED`;
2. recuperacao de lease expirado e limite de tentativas;
3. heartbeat durante etapas longas;
4. transicoes, eventos, conclusao e report em transacoes;
5. fixture tecnica honesta, sem simular evidencia de streaming.

## Definition of Done

- Usuario cria uma investigacao por URL.
- Browser navega imediatamente para o caso.
- Worker publica eventos reais de lifecycle.
- Recarregar a pagina restaura a timeline.
- Reiniciar a API nao perde estado.
- Um job abandonado pode ser recuperado.

Todos os itens foram validados, incluindo recuperacao real de um lease expirado.

## Fora da fase

- Download de stream.
- FFprobe.
- Agentes especialistas reais.
- Polimento visual final.
