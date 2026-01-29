# Omni v2 Makefile
# Universal Event-Driven Omnichannel Platform

.PHONY: help install dev dev-services dev-stop build clean \
        test test-watch typecheck lint format check \
        db-push db-migrate db-studio db-reset \
        ensure-nats start stop restart logs status \
        kill-ghosts reset sdk-generate

# Default target
help:
	@echo "Omni v2 - Development Commands"
	@echo ""
	@echo "Development:"
	@echo "  make install       Install all dependencies"
	@echo "  make dev           Start dev services + watch mode"
	@echo "  make dev-services  Start pgserve + nats via PM2"
	@echo "  make dev-stop      Stop PM2 dev services"
	@echo ""
	@echo "Quality:"
	@echo "  make check         Run all quality checks (typecheck + lint + test)"
	@echo "  make typecheck     TypeScript type checking"
	@echo "  make lint          Run Biome linter"
	@echo "  make format        Format code with Biome"
	@echo "  make test          Run all tests"
	@echo "  make test-watch    Run tests in watch mode"
	@echo ""
	@echo "Database:"
	@echo "  make db-push       Push schema changes (dev)"
	@echo "  make db-migrate    Run migrations (prod)"
	@echo "  make db-studio     Open Drizzle Studio"
	@echo "  make db-reset      Reset database (DESTRUCTIVE)"
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

install:
	bun install

# Start dev services (PM2) then run turbo dev
dev: dev-services
	bun run dev

# Start managed services via PM2 (reads *_MANAGED from .env)
dev-services: ensure-nats
	@if [ ! -f .env ]; then \
		echo "Creating .env from .env.example..."; \
		cp .env.example .env; \
	fi
	@echo "Starting managed services..."
	pm2 start ecosystem.config.cjs --env development || true
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

format:
	bunx biome format --write .

test:
	bun test

test-watch:
	bun test --watch

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
	pm2 start ecosystem.config.cjs

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
