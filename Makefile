# Stream Lens — comandos de desenvolvimento unificados
# Requer: python3 (3.12+), nvm com Node 22.12.0, Docker (para compose)

SHELL := /bin/zsh
BACKEND := backend
FRONTEND := frontend
VENV := .venv
PY := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn
NVM_SOURCE := source ~/.nvm/nvm.sh && nvm use 22.12.0 >/dev/null

.DEFAULT_GOAL := help

.PHONY: help
help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: bootstrap
bootstrap: ## Instala dependências do backend e frontend
	$(PY) -m pip install -q -r $(BACKEND)/requirements.txt -r $(BACKEND)/requirements-dev.txt
	cd $(FRONTEND) && ($(NVM_SOURCE) && npm install)

.PHONY: back
back: ## Sobe o backend (FastAPI) em http://localhost:8000
	cd $(BACKEND) && PYTHONPATH=src ../$(UVICORN) stream_lens.adapters.inbound.http.asgi:app --reload

.PHONY: front
front: ## Sobe o frontend (Vite) em http://localhost:5173 (proxy /api -> 8000)
	cd $(FRONTEND) && ($(NVM_SOURCE) && npm run dev)

.PHONY: dev
dev: ## Sobe backend (:8000) + frontend (:5173) juntos, sem Docker (Ctrl-C derruba os dois)
	@cd $(CURDIR)/$(BACKEND) && PYTHONPATH=src $(CURDIR)/$(UVICORN) stream_lens.adapters.inbound.http.asgi:app --reload & \
	back_pid=$$!; \
	trap 'kill $$back_pid 2>/dev/null' INT TERM EXIT; \
	cd $(CURDIR)/$(FRONTEND) && ($(NVM_SOURCE) && npm run dev)

.PHONY: compose-up
compose-up: ## Sobe tudo via Docker Compose (UI :8080, API :8000)
	docker compose up --build

.PHONY: compose-down
compose-down: ## Derruba o Docker Compose (mantém o volume de inspeções)
	docker compose down

.PHONY: compose-clean
compose-clean: ## Derruba o Compose e remove o volume de inspeções
	docker compose down -v

.PHONY: test
test: test-backend test-frontend ## Roda todos os testes

.PHONY: test-backend
test-backend: ## Testes do backend (pytest)
	cd $(BACKEND) && ../$(PY) -m pytest

.PHONY: test-frontend
test-frontend: ## Testes do frontend (vitest)
	cd $(FRONTEND) && ($(NVM_SOURCE) && npm test)

.PHONY: lint
lint: lint-backend lint-frontend ## Ruff + mypy + tsc + oxlint

.PHONY: lint-backend
lint-backend: ## Ruff e mypy no backend
	cd $(BACKEND) && ../$(PY) -m ruff check src tests && ../$(PY) -m mypy

.PHONY: lint-frontend
lint-frontend: ## tsc e oxlint no frontend
	cd $(FRONTEND) && ($(NVM_SOURCE) && npm run lint)

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
