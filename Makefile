dev: dev-api

dev-api:
	npm run dev

dev-ui:
	npm run ui:dev

check:
	npm run check
	npm --prefix ui run check

test:
	npm test

build:
	npm run build
	npm --prefix ui run build

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

logs-app:
	docker compose logs -f app

logs-lens:
	docker compose logs -f lens

logs-mock:
	docker compose logs -f mock

.PHONY: dev dev-api dev-ui check test build up down logs logs-app logs-lens logs-mock
