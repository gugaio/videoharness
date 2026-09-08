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

dc-up:
	docker compose up -d --build

dc-down:
	docker compose down

dc-logs:
	docker compose logs -f

dc-logs-app:
	docker compose logs -f app

dc-logs-lens:
	docker compose logs -f lens

dc-logs-mock:
	docker compose logs -f mock

.PHONY: dev dev-api dev-ui check test build dc-up dc-down dc-logs dc-logs-app dc-logs-lens dc-logs-mock
