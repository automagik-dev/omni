# Omni v2 Makefile
# Universal Event-Driven Omnichannel Platform

.PHONY: help install dev dev-api dev-nats build start stop clean \
        test test-watch typecheck lint format \
        db-push db-migrate db-studio db-reset \
        nats-start nats-stop nats-status \
        logs status

# Default target
help:
	@echo "Omni v2 - Development Commands"
	@echo ""
	@echo "Development:"
	@echo "  make install      Install all dependencies"
	@echo "  make dev          Start all services in dev mode"
	@echo "  make dev-api      Start API server only"
	@echo "  make dev-nats     Start NATS server only"
	@echo ""
	@echo "Building:"
	@echo "  make build        Build all packages"
	@echo "  make clean        Clean build artifacts"
	@echo ""
	@echo "Testing:"
	@echo "  make test         Run all tests"
	@echo "  make test-watch   Run tests in watch mode"
	@echo "  make typecheck    TypeScript type checking"
	@echo "  make lint         Run linter"
	@echo "  make format       Format code"
	@echo ""
	@echo "Database:"
	@echo "  make db-push      Push schema changes (dev)"
	@echo "  make db-migrate   Run migrations (prod)"
	@echo "  make db-studio    Open Drizzle Studio"
	@echo "  make db-reset     Reset database (DESTRUCTIVE)"
	@echo ""
	@echo "NATS:"
	@echo "  make nats-start   Start NATS server"
	@echo "  make nats-stop    Stop NATS server"
	@echo "  make nats-status  Check NATS status"
	@echo ""
	@echo "Production:"
	@echo "  make start        Start production (PM2)"
	@echo "  make stop         Stop all services"
	@echo "  make logs         View logs"
	@echo "  make status       Check service status"

# ============================================================================
# Development
# ============================================================================

install:
	bun install

dev: nats-start
	bun run dev

dev-api:
	bun run dev:api

dev-nats:
	nats-server --jetstream --store_dir /tmp/nats-data

# ============================================================================
# Building
# ============================================================================

build:
	bun run build

clean:
	rm -rf node_modules/.cache
	rm -rf packages/*/dist
	rm -rf .turbo

# ============================================================================
# Testing
# ============================================================================

test:
	bun test

test-watch:
	bun test --watch

typecheck:
	bun run typecheck

lint:
	bun run lint

format:
	bun run format

# ============================================================================
# Database (Drizzle)
# ============================================================================

db-push:
	bun run db:push

db-migrate:
	bun run db:migrate

db-studio:
	bun run db:studio

db-reset:
	@echo "WARNING: This will delete all data!"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	bun run db:reset

# ============================================================================
# NATS
# ============================================================================

NATS_DATA_DIR ?= /tmp/nats-data
NATS_PID_FILE ?= /tmp/nats.pid

nats-start:
	@if [ -f $(NATS_PID_FILE) ] && kill -0 $$(cat $(NATS_PID_FILE)) 2>/dev/null; then \
		echo "NATS already running (PID: $$(cat $(NATS_PID_FILE)))"; \
	else \
		mkdir -p $(NATS_DATA_DIR); \
		nats-server --jetstream --store_dir $(NATS_DATA_DIR) --pid $(NATS_PID_FILE) -D & \
		sleep 1; \
		echo "NATS started (PID: $$(cat $(NATS_PID_FILE)))"; \
	fi

nats-stop:
	@if [ -f $(NATS_PID_FILE) ]; then \
		kill $$(cat $(NATS_PID_FILE)) 2>/dev/null || true; \
		rm -f $(NATS_PID_FILE); \
		echo "NATS stopped"; \
	else \
		echo "NATS not running"; \
	fi

nats-status:
	@if [ -f $(NATS_PID_FILE) ] && kill -0 $$(cat $(NATS_PID_FILE)) 2>/dev/null; then \
		echo "NATS running (PID: $$(cat $(NATS_PID_FILE)))"; \
		nats server info 2>/dev/null || echo "  (nats CLI not available for details)"; \
	else \
		echo "NATS not running"; \
	fi

# ============================================================================
# Production (PM2)
# ============================================================================

start:
	pm2 start ecosystem.config.js

stop:
	-pm2 stop all 2>/dev/null || true
	-pm2 delete all 2>/dev/null || true
	@$(MAKE) nats-stop
	@$(MAKE) kill-ghosts

restart:
	pm2 restart all

logs:
	pm2 logs

status:
	pm2 status
	@echo ""
	@$(MAKE) nats-status

# Kill ghost processes that might block ports
kill-ghosts:
	@echo "Cleaning up ghost processes..."
	-pkill -f "bun run" 2>/dev/null || true
	-pkill -f "bunx" 2>/dev/null || true
	-lsof -ti :3000 | xargs kill -9 2>/dev/null || true
	-lsof -ti :4222 | xargs kill -9 2>/dev/null || true
	-lsof -ti :8080 | xargs kill -9 2>/dev/null || true
	@echo "Ghost cleanup complete"

# ============================================================================
# Utilities
# ============================================================================

# Generate SDK from OpenAPI spec
sdk-generate:
	bun run sdk:generate

# Run all quality checks
check: typecheck lint test
	@echo "All checks passed!"

# Full clean and reinstall
reset: clean
	rm -rf node_modules
	rm -rf packages/*/node_modules
	bun install
