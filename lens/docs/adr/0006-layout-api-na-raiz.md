# ADR-0006 — Projeto Python na raiz da Lens

Status: aceito · Data: 2026-09-19

## Contexto

Após a remoção do frontend (ADR-0005), `backend/` apenas acrescentava um nível
ao único serviço. O usuário solicitou simplificar a estrutura da API.

## Decisão

- Mover `src/`, `tests/`, `pyproject.toml`, requirements e Dockerfile para a raiz.
- Manter fixtures, documentação e catálogo de skills junto ao projeto Python.
- Usar `make dev`, `make test` e `make lint`, removendo aliases de backend.
- Nomear o serviço standalone do Compose `api` e usar o Dockerfile da raiz.
- Remover placeholders vazios; preservar domínio, casos de uso e adapters,
  que isolam parsing, HTTP, filesystem e subprocess de maneira útil à API.
- Preservar API HTTP, CLI, snapshot, variáveis de ambiente e volumes de dados.

## Consequências

Build, testes e desenvolvimento partem do mesmo diretório. CI e Compose do VH
usam os novos caminhos; a integração continua exclusivamente HTTP. Os caminhos
relativos de fixtures e workspace são ajustados à nova profundidade, mantendo
`.runtime/inspections` na raiz da Lens. Scripts externos que usavam `backend/`,
`make back`, `test-backend` ou `lint-backend` precisam usar os comandos acima.
No Compose standalone, `docker compose logs api` substitui `logs backend`.
