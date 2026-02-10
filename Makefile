# Omni v2 Makefile
# Universal Event-Driven Omnichannel Platform

.PHONY: help install dev dev-api dev-ui dev-services dev-stop build build-ui clean \
        test test-watch test-api test-db typecheck typecheck-ui lint lint-fix lint-ui format check \
        db-push db-migrate db-studio db-reset \
        ensure-nats ensure-ffmpeg check-ffmpeg check-deps start stop restart logs status \
        restart-api restart-nats restart-pgserve logs-api \
        kill-ghosts reset sdk-generate \
        cli cli-build cli-link \
        migrate-messages migrate-messages-dry \
        _init-db-wait

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
	@echo "  make dev-ui        Start UI dev server (Vite on :5173)"
	@echo "  make dev-services  Start infrastructure (pgserve + NATS) via PM2"
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
	@echo "  make build-ui      Build UI for production"
	@echo "  make clean         Clean build artifacts"
	@echo ""
	@echo "Production:"
	@echo "  make start         Start production (PM2)"
	@echo "  make stop          Stop all services"
	@echo "  make restart       Restart all services"
	@echo "  make logs          View logs"
	@echo "  make status        Check service status"
	@echo ""
	@echo "Individual Services:"
	@echo "  make restart-api     Restart API only"
	@echo "  make restart-nats    Restart NATS only"
	@echo "  make restart-pgserve Restart PostgreSQL only"
	@echo "  make logs-api        View API logs"
	@echo ""
	@echo "CLI:"
	@echo "  make cli ARGS=\"...\"  Run CLI from source"
	@echo "  make cli-build       Build CLI package"
	@echo "  make cli-link        Build + link globally (omni command)"
	@echo ""
	@echo "SDK:"
	@echo "  make sdk-generate    Generate SDK from OpenAPI spec"
	@echo ""
	@echo "Setup:"
	@echo "  make check-deps    Check for required dependencies"
	@echo "  make ensure-nats   Download NATS binary if missing"
	@echo "  make ensure-ffmpeg Install ffmpeg (for WhatsApp voice note conversion)"
	@echo "  make check-ffmpeg  Check if ffmpeg is installed"
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

# Retry-based DB init: waits for PostgreSQL to be ready (used by setup/dev after dev-services)
_init-db-wait: _setup-env
	@echo "Initializing database schema (waiting for PostgreSQL)..."
	@set -a && . ./.env && set +a && \
	for i in $$(seq 1 15); do \
		(cd packages/db && bun x drizzle-kit push --force) >/dev/null 2>&1 && \
		echo "✓ Database schema initialized" && exit 0 || \
		sleep 1; \
	done; \
	echo "⚠️  Could not initialize database (is PostgreSQL running?)" && exit 1

# Check dependencies
check-deps:
	@./scripts/check-dependencies.sh

# Complete setup: install + services + init DB + build SDK + start all
# Order matters: dev-services starts PostgreSQL, _init-db-wait retries until DB is ready,
# _build-dist builds SDK before UI needs it, then turbo dev starts API + UI.
setup: check-deps install dev-services _init-db-wait _build-dist
	@echo ""
	@echo "✓ Setup complete! Starting development..."
	bun run dev

# Start dev services (PM2), init DB if needed, build SDK, then run turbo dev
dev: dev-services _init-db-wait _build-dist
	bun run dev

# Start just the API (assumes services already running)
# OMNI_PACKAGES_DIR is passed explicitly to ensure correct plugin directory
dev-api:
	@set -a && . ./.env && set +a && OMNI_PACKAGES_DIR=/home/cezar/dev/omni-v2/packages bun --watch packages/api/src/index.ts

# Start infrastructure services via PM2 (pgserve + NATS only)
# API is NOT started here — turbo dev handles it (avoids port conflicts, see GH #14)
dev-services: ensure-nats
	@if [ ! -f .env ]; then \
		echo "Creating .env from .env.example..."; \
		cp .env.example .env; \
	fi
	@echo "Starting infrastructure services (pgserve + NATS)..."
	@set -a && . ./.env && set +a && API_MANAGED=false pm2 start ecosystem.config.cjs || true
	@sleep 2
	@$(MAKE) status

# Stop PM2 dev services
dev-stop:
	-pm2 stop ecosystem.config.cjs 2>/dev/null || true
	-pm2 delete ecosystem.config.cjs 2>/dev/null || true
	@echo "Dev services stopped"

# Start UI dev server (Vite)
dev-ui:
	cd apps/ui && bun run dev

# ============================================================================
# Quality Checks
# ============================================================================

typecheck: _build-dist
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

lint-ui:
	cd apps/ui && bun run lint

typecheck-ui:
	cd apps/ui && bun run typecheck

lint-core:
	bunx biome check packages/core

format:
	bunx biome format --write .

test: _build-dist
	bun test --env-file=.env

test-watch: _build-dist
	bun test --env-file=.env --watch

# Build SDK and CLI dist (required for CLI tests)
_build-dist:
	@if [ ! -d packages/sdk/dist ]; then \
		echo "Building SDK..."; \
		cd packages/sdk && bun run build; \
	fi
	@if [ ! -d packages/cli/dist ]; then \
		echo "Building CLI..."; \
		cd packages/cli && bun run build; \
	fi

# Run tests for specific packages (load .env from root)
test-api:
	bun test --env-file=.env packages/api/src

test-db:
	bun test --env-file=.env packages/db/src

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

build-ui:
	cd apps/ui && bun run build

clean:
	rm -rf node_modules/.cache
	rm -rf packages/*/dist
	rm -rf apps/*/dist
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
	@echo "  API:        http://localhost:$${API_PORT:-8882}"
	@echo "  Swagger:    http://localhost:$${API_PORT:-8882}/api/v2/docs"
	@echo "  PostgreSQL: localhost:$${PGSERVE_PORT:-8432}"
	@echo "  NATS:       localhost:$${NATS_PORT:-4222}"

# Individual service control
restart-api:
	pm2 restart omni-api

restart-nats:
	pm2 restart omni-nats

restart-pgserve:
	pm2 restart omni-pgserve

logs-api:
	pm2 logs omni-api --lines 100

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
	bun run generate:sdk

# CLI commands
cli:
	@bun packages/cli/src/index.ts $(ARGS)

cli-build:
	bun run --cwd packages/cli build

cli-link: cli-build
	cd packages/cli && bun link
	@echo "✓ 'omni' command now available globally"

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

# ============================================================================
# FFmpeg Setup (for WhatsApp voice note conversion)
# ============================================================================

# Check if ffmpeg is installed
check-ffmpeg:
	@echo "Checking ffmpeg installation..."
	@if command -v ffmpeg >/dev/null 2>&1; then \
		echo "✓ ffmpeg is installed"; \
		ffmpeg -version 2>&1 | head -1; \
		echo ""; \
		echo "Checking for libopus codec support..."; \
		if ffmpeg -encoders 2>/dev/null | grep -q libopus; then \
			echo "✓ libopus codec available"; \
		else \
			echo "⚠️  libopus codec not available (voice note conversion may not work)"; \
		fi; \
	else \
		echo "✗ ffmpeg is NOT installed"; \
		echo ""; \
		echo "Run 'make ensure-ffmpeg' to install it"; \
	fi

# Install ffmpeg with opus support (auto-detects OS)
ensure-ffmpeg:
	@echo "Installing ffmpeg..."
	@if command -v ffmpeg >/dev/null 2>&1; then \
		echo "✓ ffmpeg is already installed"; \
		$(MAKE) check-ffmpeg; \
	elif [ "$$(uname)" = "Darwin" ]; then \
		echo "Detected macOS - using Homebrew..."; \
		if command -v brew >/dev/null 2>&1; then \
			brew install ffmpeg; \
		else \
			echo "✗ Homebrew not found. Please install it first:"; \
			echo "  /bin/bash -c \"\$$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""; \
			exit 1; \
		fi; \
	elif [ -f /etc/debian_version ]; then \
		echo "Detected Debian/Ubuntu - using apt..."; \
		sudo apt-get update && sudo apt-get install -y ffmpeg; \
	elif [ -f /etc/fedora-release ]; then \
		echo "Detected Fedora - using dnf..."; \
		sudo dnf install -y ffmpeg; \
	elif [ -f /etc/arch-release ]; then \
		echo "Detected Arch Linux - using pacman..."; \
		sudo pacman -S --noconfirm ffmpeg; \
	elif [ -f /etc/alpine-release ]; then \
		echo "Detected Alpine - using apk..."; \
		sudo apk add --no-cache ffmpeg; \
	elif grep -qi microsoft /proc/version 2>/dev/null; then \
		echo "Detected WSL - using apt..."; \
		sudo apt-get update && sudo apt-get install -y ffmpeg; \
	else \
		echo "✗ Could not detect OS. Please install ffmpeg manually:"; \
		echo ""; \
		echo "  macOS:        brew install ffmpeg"; \
		echo "  Ubuntu/Debian: sudo apt install ffmpeg"; \
		echo "  Fedora:       sudo dnf install ffmpeg"; \
		echo "  Arch:         sudo pacman -S ffmpeg"; \
		echo "  Alpine:       apk add ffmpeg"; \
		echo "  Windows:      choco install ffmpeg"; \
		exit 1; \
	fi
	@echo ""
	@echo "✓ ffmpeg installation complete!"
	@$(MAKE) check-ffmpeg

# Integration test for messaging
test-messaging:
	@echo "Running messaging integration tests..."
	bun --env-file=.env scripts/test-messaging.ts

test-messaging-whatsapp:
	@echo "Running WhatsApp integration tests..."
	bun --env-file=.env scripts/test-messaging.ts --channel=whatsapp

test-messaging-discord:
	@echo "Running Discord integration tests..."
	bun --env-file=.env scripts/test-messaging.ts --channel=discord
