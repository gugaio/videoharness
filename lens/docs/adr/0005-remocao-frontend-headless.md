# ADR-0005 — Remoção do frontend; Lens headless (API + CLI)

Status: aceito · Data: 2026-09-12

## Contexto

O frontend React (`frontend/`) era a interface standalone da Lens. Com a
integração ao Video Harness, o orquestrador consome a API HTTP e apresenta o
snapshot canônico em sua própria UI (views portadas para `ui/` no repositório
do orquestrador). Manter dois frontends duplicava manutenção — toolchain
Node/nvm, testes de componente, segunda imagem (nginx) no Compose — sem
atender usuário algum: o consumo real é programático (orquestrador e agentes
via skills) e via CLI.

## Decisão

- A Lens passa a ser um serviço **headless**: API FastAPI + CLI.
- O diretório `frontend/` é removido, junto com os targets de Makefile
  (`front`, `test-frontend`, `lint-frontend`), o serviço `frontend` do Compose
  e as referências de build e lint de frontend.
- Frontend e agentes já consumiam o **mesmo** contrato público (sem caminho de
  dados privativo da UI, ver `docs/ARCHITECTURE.md`); nenhuma capacidade de
  inspeção é perdida.

## Consequências

- Requisitos locais caem para Python 3.12+ e Docker; sem Node/nvm.
- `make test` e `make lint` cobrem apenas o backend.
- `docs/UX.md` é removido por descrever exclusivamente a interface removida.
- Menções à UI em docs temáticos (SNAPSHOT_SCHEMA, ABR_ALIGNMENT,
  TIMELINE_HEALTH, PROJECT_STATE e afins) permanecem como registro histórico
  do racional de produto das entregas que as originaram.
- O snapshot canônico continua a única fonte de verdade; clientes de
  visualização (ex.: orquestrador do Video Harness) derivam suas telas dele.
