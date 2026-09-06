# ADR-0003 — Repositório temporário de inspeções em filesystem local, sem banco

Status: proposto (Fase 0) · Data: 2026-09-05

## Contexto

O MVP não usa banco de dados: sem login, histórico permanente ou contas. Uma inspeção tem estado temporário (job em progresso, arquivos baixados, snapshot) durante execução e TTL.

## Decisão

- Port `InspectionRepository`/`SnapshotRepository` implementado primeiro sobre **filesystem local** (`<workspace>/<inspection_id>/` com `status.json`, `source/`, `segments/`, `derived/`, `snapshot.json`), atrás de interface — a Fase 1 pode começar com implementação in-memory para testes, mas o adapter filesystem é o alvo.
- ID aleatório e não previsível (UUIDv4 ou segredo equivalente).
- Escrita **atômica** (tmp + rename) para status e snapshot.
- TTL configurável; job/rotina de limpeza remove expirados (`make clean-expired`).
- Limites explícitos: duração da janela, segmentos por representação, bytes por resposta/inspeção, tempo total, concorrência.
- Casos de uso não dependem do filesystem — só o port.

## Consequências

- Simplicidade e debuggabilidade (inspeção é uma pasta inspecionável).
- **Sem suporte a múltiplas réplicas**: qualquer deploy com mais de uma instância exigirá um adapter compartilhado (object storage ou equivalente). Limitação documentada em `SECURITY.md`.
- Processo reiniciado pode deixar inspeções órfãs: comportamento (marcar como failed na leitura, ou limpeza por TTL) será definido e testado na Fase 2.
