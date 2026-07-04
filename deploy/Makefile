# =============================================================================
# omni deploy — OrbStack k8s helpers
# =============================================================================
# Run from repo root: `make -C deploy <target>`  (or `cd deploy && make ...`).
# Docker build context is the repo root (one level up).
# =============================================================================

SHELL          := /bin/bash
ROOT           := $(abspath $(CURDIR)/..)
CHART          := $(CURDIR)/helm/omni
PLATFORM       ?= linux/arm64
IMAGE          ?= omni-api
TAG            ?= dev
IMAGE_REF      := $(IMAGE):$(TAG)
NAMESPACE      ?= omni
RELEASE        ?= omni
VALUES         ?= $(CHART)/values-dev.yaml
PORT           ?= 8882

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}'

.PHONY: build
build: ## Build omni-api image (arm64) into OrbStack's shared store
	# buildx forces BuildKit regardless of DOCKER_BUILDKIT/daemon defaults, so
	# deploy/Dockerfile.dockerignore is always honored (classic builder would
	# silently ship the full context: .git, node_modules, data/). --load lands
	# the image in the local store even under a non-default builder driver.
	docker buildx build --platform $(PLATFORM) -f $(CURDIR)/Dockerfile -t $(IMAGE_REF) --load $(ROOT)

.PHONY: lint
lint: ## helm lint the umbrella chart
	helm lint $(CHART) -f $(VALUES)

.PHONY: template
template: ## Render manifests locally (no cluster)
	helm template $(RELEASE) $(CHART) -f $(VALUES)

.PHONY: deps
deps: ## helm dependency build (vendor subcharts into charts/)
	helm dependency build $(CHART)

.PHONY: deploy
deploy: ## Install/upgrade the release to ns $(NAMESPACE)
	helm dependency build $(CHART) || true
	helm upgrade --install $(RELEASE) $(CHART) \
	  --namespace $(NAMESPACE) --create-namespace \
	  -f $(VALUES) --wait --timeout 5m

.PHONY: status
status: ## Rollout status + pods
	kubectl -n $(NAMESPACE) rollout status deploy/$(RELEASE) --timeout=5m || true
	kubectl -n $(NAMESPACE) get pods,svc,pvc

.PHONY: logs
logs: ## Tail omni-api logs
	kubectl -n $(NAMESPACE) logs -l app.kubernetes.io/name=omni,app.kubernetes.io/component=api -f --tail=200

.PHONY: health
health: ## Port-forward + curl /health
	@echo "Port-forwarding svc/$(RELEASE):$(PORT) …"; \
	kubectl -n $(NAMESPACE) port-forward svc/$(RELEASE) $(PORT):$(PORT) >/tmp/omni-pf.log 2>&1 & \
	PF_PID=$$!; sleep 3; \
	echo "GET /health:"; \
	curl -fsS localhost:$(PORT)/health || echo "  (not healthy yet)"; \
	echo; kill $$PF_PID 2>/dev/null || true

.PHONY: uninstall
uninstall: ## Remove the release
	helm uninstall $(RELEASE) --namespace $(NAMESPACE) || true

.PHONY: smoke
smoke: ## Run the image locally (expects DB-connect wait without a DB)
	docker run --rm -e DATABASE_URL='postgresql://omni:omni@127.0.0.1:5432/omni' \
	  -e NATS_URL='nats://127.0.0.1:4222' $(IMAGE_REF)
