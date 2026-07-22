# Fase 1 - Thin Slice Persistente

Status: **em andamento**

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
- Worker com claim, lease e heartbeat.
- State machine minima.
- SSE com historico e `Last-Event-ID`.
- Homepage e tela de investigacao funcionais.
- Report placeholder explicitamente identificado como fixture tecnica.

## Proxima fatia

Implementar consulta e timeline inicial com:

1. `GET /v1/investigations/:id`;
2. `GET /v1/investigations/:id/events` com historico;
3. base SSE com `Last-Event-ID`;
4. pagina React do caso.

## Definition of Done

- Usuario cria uma investigacao por URL.
- Browser navega imediatamente para o caso.
- Worker publica eventos reais de lifecycle.
- Recarregar a pagina restaura a timeline.
- Reiniciar a API nao perde estado.
- Um job abandonado pode ser recuperado.

## Fora da fase

- Download de stream.
- FFprobe.
- Agentes especialistas reais.
- Polimento visual final.
