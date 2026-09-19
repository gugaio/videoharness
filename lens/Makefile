# Stream Lens — comandos de desenvolvimento unificados
# Requer: python3 (3.12+), Docker (para compose)
# Serviço headless (ADR-0005): API FastAPI + CLI, sem frontend.

SHELL := /bin/sh
VENV := .venv
PY := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn

.DEFAULT_GOAL := help

.PHONY: help
help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: bootstrap
bootstrap: ## Cria o venv e instala as dependências
	[ -x "$(PY)" ] || python3 -m venv $(VENV)
	$(PY) -m pip install -q -r requirements.txt -r requirements-dev.txt

.PHONY: dev
dev: ## Sobe a API em http://localhost:8000 com reload
	PYTHONPATH=src $(UVICORN) stream_lens.adapters.inbound.http.asgi:app --reload

.PHONY: compose-up
compose-up: ## Sobe tudo via Docker Compose (API :8000)
	docker compose up --build

.PHONY: compose-down
compose-down: ## Derruba o Docker Compose (mantém o volume de inspeções)
	docker compose down

.PHONY: compose-clean
compose-clean: ## Derruba o Compose e remove o volume de inspeções
	docker compose down -v

.PHONY: test
test: ## Roda todos os testes (pytest)
	$(PY) -m pytest

.PHONY: lint
lint: ## Ruff + mypy
	$(PY) -m ruff check src tests
	$(PY) -m mypy

.PHONY: format
format: ## Formata o código e os testes (ruff)
	$(PY) -m ruff format src tests

.PHONY: clean-expired
clean-expired: ## Remove inspeções expiradas do workspace
	PYTHONPATH=src $(PY) -m stream_lens.adapters.inbound.cli purge-expired

.PHONY: cli
cli: ## Exemplo: make cli inspect url=fixture://hls-ts/master.m3u8
	@if [ -z "$(url)" ]; then echo "uso: make cli inspect url=fixture://hls-ts/master.m3u8"; exit 2; fi
	PYTHONPATH=src $(PY) -m stream_lens.adapters.inbound.cli inspect "$(url)"

.PHONY: inspect
inspect: # Permite a sintaxe documentada: make cli inspect url=…
	@:
