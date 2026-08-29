.PHONY: all backend dev front frontend frontend-install build run clean

# Build the React frontend and start the backend (production-style).
all: build backend

# Run the Go backend (serves the built frontend from web/dist).
backend:
	go run ./cmd/server

front:
	cd web && npm run dev

# Run backend + Vite dev server (with hot reload and /api, /s proxy).
dev:
	go run ./cmd/server & \
	cd web && npm run dev

# Install frontend dependencies.
install:
	cd web && npm install

# Build the React frontend into web/dist.
build: install
	cd web && npm run build

# Clean build artifacts.
clean:
	rm -rf web/dist web/node_modules
