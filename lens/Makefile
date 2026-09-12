# Stream Lens — comandos de desenvolvimento unificados
# Requer: python3 (3.12+), Docker (para compose)
# Serviço headless (ADR-0005): API FastAPI + CLI, sem frontend.

SHELL := /bin/zsh
BACKEND := backend
VENV := .venv
PY := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn

.DEFAULT_GOAL := help

.PHONY: help
help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: bootstrap
bootstrap: ## Cria o venv (se necessário) e instala as dependências do backend
	[ -x "$(PY)" ] || python3 -m venv $(VENV)
	$(PY) -m pip install -q -r $(BACKEND)/requirements.txt -r $(BACKEND)/requirements-dev.txt

.PHONY: back
back: ## Sobe a API (FastAPI) em http://localhost:8000
	cd $(BACKEND) && PYTHONPATH=src ../$(UVICORN) stream_lens.adapters.inbound.http.asgi:app --reload

.PHONY: dev
dev: ## Alias de back (serviço headless: só API)
	cd $(BACKEND) && PYTHONPATH=src ../$(UVICORN) stream_lens.adapters.inbound.http.asgi:app --reload

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
test: test-backend ## Roda todos os testes (backend)

.PHONY: test-backend
test-backend: ## Testes do backend (pytest)
	cd $(BACKEND) && ../$(PY) -m pytest

.PHONY: lint
lint: lint-backend ## Ruff + mypy

.PHONY: lint-backend
lint-backend: ## Ruff e mypy no backend
	cd $(BACKEND) && ../$(PY) -m ruff check src tests && ../$(PY) -m mypy

.PHONY: format
format: ## Formata o backend (ruff)
	cd $(BACKEND) && ../$(PY) -m ruff format src tests

.PHONY: clean-expired
clean-expired: ## Remove inspeções expiradas do workspace
	cd $(BACKEND) && PYTHONPATH=src ../$(PY) -m stream_lens.adapters.inbound.cli purge-expired

.PHONY: cli
cli: ## Exemplo: make cli inspect url=fixture://hls-ts/master.m3u8
	@if [ -z "$(url)" ]; then echo "uso: make cli inspect url=fixture://hls-ts/master.m3u8"; exit 2; fi
	cd $(BACKEND) && PYTHONPATH=src ../$(PY) -m stream_lens.adapters.inbound.cli inspect $(url)
