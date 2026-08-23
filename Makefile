.PHONY: all backend dev front frontend frontend-install build run clean

# Build the React frontend and start the backend (production-style).
all: build backend

# Run the Go backend (serves the built frontend from web/dist).
backend:
	go run ./cmd/server

# Run backend + Vite dev server (with hot reload and /api, /s proxy).
dev:
	go run ./cmd/server & \
	cd web && npm run dev

# Run the frontend dev server (Vite, with hot reload and /api, /s proxy).
front:
	cd web && npm run dev

# Install frontend dependencies.
frontend-install:
	cd web && npm install

# Build the React frontend into web/dist.
frontend: frontend-install
	cd web && npm run build

# Alias for frontend.
build: frontend

# Clean build artifacts.
clean:
	rm -rf web/dist web/node_modules