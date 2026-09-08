# ADR-0001 — Ferramentas e gestão de dependências

Status: proposto (Fase 0) · Data: 2026-09-05

## Contexto

Inventário do ambiente: Python 3.14.0 (`python3` do sistema), Node 22.12.0 via nvm (alias `nvm22`; npm 10.9.0 — decisão do usuário; a versão default do shell era 26.7.0 e não deve ser usada), FFmpeg/ffprobe 8.0.1, Docker 29.0.2, GNU Make 3.81. `uv` não será usado (decisão do usuário). Não há convenção prévia no repositório (vazio).

## Decisão

- **Backend**: Python + FastAPI + Pydantic (DTOs/contratos); dataclasses/enums no domínio; `typing.Protocol` para ports; pytest; Ruff + type checking (mypy ou pyright, definido na Fase 1); HTTP client assíncrono (httpx); ffprobe/FFmpeg atrás de adapter (argv, nunca shell).
- **Gestão de dependências Python**: `python3` (3.14.0 do sistema) + `venv` + `pip` com `requirements.txt`/`requirements-dev.txt` locked. Sem `uv` (decisão do usuário). Comandos sempre encapsulados no Makefile (`make bootstrap` cria o venv).
- **Frontend**: React + TypeScript + Vite; TanStack Query; npm com **Node 22.12.0 via nvm** (alias `nvm22`; em shells não interativos, `nvm use 22.12.0`); um `.nvmrc` com `22.12.0` na raiz do frontend; API client e tipos derivados de OpenAPI sempre que viável. Sem Next.js (app client-side interativo, não site editorial).
- **Orquestração**: Makefile na raiz com os alvos listados em `docs/TESTING.md`.

## Consequências

- venv+pip é universal e sem ferramentas extras, em troca de lock menos rigoroso (mitigado com requirements pinados e CI).
- Python 3.14 é muito recente: validar compatibilidade das libs (FastAPI/Pydantic/httpx) na Fase 1; se houver atrito, fixar 3.12/3.13 em `requirements.txt` + toolchain local.
- Node 22.12.0 fixado por `.nvmrc`; o default do shell (26.x) não deve ser usado neste projeto.
- FFmpeg 8.0.1 será fixado no container (Fase 8) para reprodutibilidade.
