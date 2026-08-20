dev: dev-api dev-worker

dev-api:
	npm run dev:api

dev-worker:
	npm run dev:worker

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

dc-logs-api:
	docker compose logs -f api

dc-logs-worker:
	docker compose logs -f worker

artifacts:
	docker compose exec worker ls -la /data/artifacts

.PHONY: dev dev-api dev-worker dev-ui check test build dc-up dc-down dc-logs dc-logs-api dc-logs-worker artifacts