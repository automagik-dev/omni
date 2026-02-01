# Omni v2 Makefile
# Universal Event-Driven Omnichannel Platform

.PHONY: help install dev dev-api dev-services dev-stop build clean \
        test test-watch test-api test-db typecheck lint lint-fix format check \
        db-push db-migrate db-studio db-reset \
        ensure-nats start stop restart logs status \
        kill-ghosts reset sdk-generate \
        migrate-messages migrate-messages-dry

# Default target
help:
	@echo "Omni v2 - Development Commands"
	@echo ""
	@echo "Quick Start:"
	@echo "  make setup         One-command setup: install + services + dev (RECOMMENDED)"
	@echo ""
	@echo "Development:"
	@echo "  make install       Install deps + .env + init database"
	@echo "  make dev           Start services + API in watch mode"
	@echo "  make dev-api       Start just the API (services must be running)"
	@echo "  make dev-services  Start pgserve + nats via PM2"
	@echo "  make dev-stop      Stop PM2 dev services"
	@echo ""
	@echo "Quality:"
	@echo "  make check         Run all quality checks (typecheck + lint + test)"
	@echo "  make typecheck     TypeScript type checking"
	@echo "  make lint          Run Biome linter"
	@echo "  make lint-fix      Fix auto-fixable lint issues"
	@echo "  make lint-api      Lint API package only"
	@echo "  make format        Format code with Biome"
	@echo "  make test          Run all tests"
	@echo "  make test-watch    Run tests in watch mode"
	@echo "  make test-api      Run API package tests only"
	@echo "  make test-db       Run DB package tests only"
	@echo "  make test-file F=<path>  Run a specific test file"
	@echo ""
	@echo "Database:"
	@echo "  make db-push       Push schema changes (dev)"
	@echo "  make db-migrate    Run migrations (prod)"
	@echo "  make db-studio     Open Drizzle Studio"
	@echo "  make db-reset      Reset database (DESTRUCTIVE)"
	@echo ""
	@echo "Migrations:"
	@echo "  make migrate-messages-dry  Dry run: events → unified messages"
	@echo "  make migrate-messages      Run migration: events → unified messages"
	@echo ""
	@echo "Building:"
	@echo "  make build         Build all packages"
	@echo "  make clean         Clean build artifacts"
	@echo ""
	@echo "Production:"
	@echo "  make start         Start production (PM2)"
	@echo "  make stop          Stop all services"
	@echo "  make restart       Restart all services"
	@echo "  make logs          View logs"
	@echo "  make status        Check service status"
	@echo ""
	@echo "Setup:"
	@echo "  make ensure-nats   Download NATS binary if missing"
	@echo "  make reset         Full clean and reinstall"

# ============================================================================
# Development
# ============================================================================

install: _install-deps _setup-env _init-db
	@echo ""
	@echo "✓ Installation complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Start services:  make dev-services"
	@echo "  2. Start API:       make dev-api"
	@echo "  3. In another terminal:"
	@echo "     make dev"

_install-deps:
	@echo "Installing dependencies..."
	bun install

_setup-env:
	@if [ ! -f .env ]; then \
		echo "Creating .env from .env.example..."; \
		cp .env.example .env; \
		echo "✓ .env created"; \
	else \
		echo "✓ .env already exists"; \
	fi

_init-db: _setup-env
	@echo "Initializing database schema..."
	@set -a && . ./.env && set +a && \
	cd packages/db && \
	bun x drizzle-kit push --force 2>/dev/null && \
	echo "✓ Database schema initialized" || \
	echo "⚠️  Database initialization skipped (PostgreSQL may not be running yet)"

# Complete setup: install + services + start all
setup: install dev-services
	@echo ""
	@echo "✓ Setup complete! Starting development..."
	bun run dev

# Start dev services (PM2) then run turbo dev
dev: dev-services
	bun run dev

# Start just the API (assumes services already running)
# Note: Uses Node.js runtime (tsx) instead of Bun for WhatsApp Baileys WebSocket compatibility
# OMNI_PACKAGES_DIR is passed explicitly to ensure correct plugin directory
dev-api:
	@set -a && . ./.env && set +a && OMNI_PACKAGES_DIR=/home/cezar/dev/omni-v2/packages npx tsx watch --clear-screen packages/api/src/index.ts

# Start managed services via PM2 (reads *_MANAGED from .env)
dev-services: ensure-nats
	@if [ ! -f .env ]; then \
		echo "Creating .env from .env.example..."; \
		cp .env.example .env; \
	fi
	@echo "Starting managed services..."
	@set -a && . ./.env && set +a && pm2 start ecosystem.config.cjs || true
	@sleep 2
	@$(MAKE) status

# Stop PM2 dev services
dev-stop:
	-pm2 stop ecosystem.config.cjs 2>/dev/null || true
	-pm2 delete ecosystem.config.cjs 2>/dev/null || true
	@echo "Dev services stopped"

# ============================================================================
# Quality Checks
# ============================================================================

typecheck:
	bun run typecheck

lint:
	bunx biome check .

lint-fix:
	bunx biome check --write .

# Lint specific packages (faster during development)
lint-api:
	bunx biome check packages/api

lint-db:
	bunx biome check packages/db

lint-core:
	bunx biome check packages/core

format:
	bunx biome format --write .

test:
	bun test

test-watch:
	bun test --watch

# Run tests for specific packages
test-api:
	cd packages/api && bun test

test-db:
	cd packages/db && bun test

# Run a specific test file (usage: make test-file F=packages/api/src/__tests__/foo.test.ts)
test-file:
	@if [ -z "$(F)" ]; then echo "Usage: make test-file F=<path-to-test-file>"; exit 1; fi
	bun test $(F)

# Run all quality checks
check: typecheck lint test
	@echo ""
	@echo "All checks passed!"

# ============================================================================
# Database (Drizzle)
# ============================================================================

db-push:
	cd packages/db && bunx drizzle-kit push --force

db-migrate:
	bun run --filter @omni/db db:migrate

db-studio:
	bun run --filter @omni/db db:studio

db-reset:
	@echo "WARNING: This will delete all data!"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@echo "Resetting database..."
	@# TODO: Implement reset logic

# ============================================================================
# Building
# ============================================================================

build:
	bun run build

clean:
	rm -rf node_modules/.cache
	rm -rf packages/*/dist
	rm -rf .turbo
	@echo "Clean complete"

# ============================================================================
# NATS Setup
# ============================================================================

ensure-nats:
	@./scripts/ensure-nats.sh

# ============================================================================
# Production (PM2)
# ============================================================================

start: ensure-nats
	@set -a && . ./.env && set +a && pm2 start ecosystem.config.cjs

stop:
	-pm2 stop all 2>/dev/null || true
	-pm2 delete all 2>/dev/null || true
	@$(MAKE) kill-ghosts

restart:
	pm2 restart all

logs:
	pm2 logs

status:
	@pm2 list 2>/dev/null || echo "PM2 not running"
	@echo ""
	@echo "Service URLs:"
	@echo "  API:        http://localhost:$${API_PORT:-8881}"
	@echo "  Swagger:    http://localhost:$${API_PORT:-8881}/api/v2/docs"
	@echo "  PostgreSQL: localhost:$${PGSERVE_PORT:-8432}"
	@echo "  NATS:       localhost:$${NATS_PORT:-4222}"

# Kill ghost processes that might block ports
kill-ghosts:
	@echo "Cleaning up ghost processes..."
	-pkill -f "bun run" 2>/dev/null || true
	-pkill -f "bunx pgserve" 2>/dev/null || true
	-pkill -f "nats-server" 2>/dev/null || true
	-lsof -ti :3000 | xargs kill -9 2>/dev/null || true
	-lsof -ti :4222 | xargs kill -9 2>/dev/null || true
	-lsof -ti :8432 | xargs kill -9 2>/dev/null || true
	@echo "Ghost cleanup complete"

# ============================================================================
# Utilities
# ============================================================================

# Generate SDK from OpenAPI spec
sdk-generate:
	bun run sdk:generate

# Full clean and reinstall
reset: clean stop
	rm -rf node_modules
	rm -rf packages/*/node_modules
	rm -rf .pgserve-data
	bun install
	@echo "Reset complete"

# ============================================================================
# Data Migrations
# ============================================================================

# Migrate events to unified messages (dry run - no changes)
migrate-messages-dry:
	@echo "Running migration dry-run (no changes will be made)..."
	cd packages/api && bun run scripts/migrate-events-to-messages.ts --dry-run

# Migrate events to unified messages (LIVE - makes changes)
migrate-messages:
	@echo "WARNING: This will migrate events to the unified messages schema."
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	cd packages/api && bun run scripts/migrate-events-to-messages.ts
