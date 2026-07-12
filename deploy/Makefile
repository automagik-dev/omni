# =============================================================================
# omni deploy — k8s helpers (local OrbStack/k3d dev + realm deploys)
# =============================================================================
# Run from repo root: `make -C deploy <target>`  (or `cd deploy && make ...`).
# Docker build context is the repo root (one level up).
#
# REALM selects the values overlay for lint/template/deploy (see README.md):
#   make -C deploy deploy                REALM=dev (default, local self-host)
#   make -C deploy template REALM=homolog HELM_EXTRA='--set ingress.host=…'
#   make -C deploy deploy   REALM=prod    HELM_EXTRA='--set ingress.host=…'
# Explicit VALUES=… still wins over REALM (backward compatible).
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
REALM          ?= dev
VALUES         ?= $(CHART)/values-$(REALM).yaml
# Extra helm args for template/deploy (e.g. --set ingress.host=… for
# homolog/prod, whose overlays fail-fast without a host).
HELM_EXTRA     ?=
PORT           ?= 8882

# Admin UI (khal-ui) bearer key — supplied at deploy time, NEVER committed. When
# set, it is injected into the UI BFF's Secret via --set-string; empty → no flag
# (the UI, when enabled, runs keyless until a key is provided). --set-string
# avoids any type coercion of the omni_sk_ value.
OMNI_API_KEY   ?=
ADMIN_UI_KEY_SET := $(if $(OMNI_API_KEY),--set-string adminUi.secret.env.OMNI_API_KEY=$(OMNI_API_KEY),)

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

.PHONY: build-autopg
build-autopg: ## Build autopg:dev image from deploy/autopg.Dockerfile
	docker buildx build --platform $(PLATFORM) -f $(CURDIR)/autopg.Dockerfile \
	  -t autopg:dev --load $(CURDIR)

.PHONY: build-ui
build-ui: ## Build omni-admin-ui:dev image (needs @khal-os token in ~/.npmrc)
	# The UI image bundles PRIVATE @khal-os/* packages; the git.namastex.io token
	# is read from ~/.npmrc and passed as a BuildKit secret (never baked into a
	# layer). Context is the repo root (the Dockerfile COPYs apps/khal-ui +
	# packages/sdk). buildx forces BuildKit so the secret mount + per-Dockerfile
	# .dockerignore are honored.
	docker buildx build --platform $(PLATFORM) -f $(CURDIR)/Dockerfile.admin-ui \
	  --secret id=npmrc,src=$(HOME)/.npmrc \
	  -t omni-admin-ui:$(TAG) --load $(ROOT)

.PHONY: lint
lint: ## helm lint the umbrella chart
	helm lint $(CHART) -f $(VALUES) $(HELM_EXTRA)

.PHONY: template
template: ## Render manifests locally (no cluster)
	helm template $(RELEASE) $(CHART) -f $(VALUES) $(HELM_EXTRA)

.PHONY: deps
deps: ## helm dependency build (vendor subcharts into charts/)
	helm dependency build $(CHART)

.PHONY: deploy
deploy: ## Install/upgrade the release to ns $(NAMESPACE) (OMNI_API_KEY=… for the UI)
	helm dependency build $(CHART) || true
	helm upgrade --install $(RELEASE) $(CHART) \
	  --namespace $(NAMESPACE) --create-namespace \
	  -f $(VALUES) $(HELM_EXTRA) $(ADMIN_UI_KEY_SET) --wait --timeout 5m

.PHONY: redeploy
redeploy: build ## Rebuild omni-api image + rollout restart (repick the fixed :dev tag)
	# The dev image tag is fixed (:dev) with pullPolicy Never, so a plain `deploy`
	# leaves the pod on the old image after a rebuild — force a rollout.
	kubectl -n $(NAMESPACE) rollout restart deploy/$(RELEASE)
	kubectl -n $(NAMESPACE) rollout status deploy/$(RELEASE) --timeout=5m

.PHONY: redeploy-ui
redeploy-ui: build-ui ## Rebuild omni-admin-ui image + rollout restart the UI pod
	# Same fixed-:dev-tag reason as `redeploy`: force the admin-ui Deployment to
	# repick the rebuilt image.
	kubectl -n $(NAMESPACE) rollout restart deploy/$(RELEASE)-admin-ui
	kubectl -n $(NAMESPACE) rollout status deploy/$(RELEASE)-admin-ui --timeout=5m

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

# -----------------------------------------------------------------------------
# deploy-smoke — prove the OSS self-host path installs end-to-end on a
# disposable local cluster, then tear it down (cleanup runs even on failure).
#
# Required tools: docker (daemon running), helm, kubectl, and k3d OR kind.
#   If neither k3d nor kind is installed, k3d is auto-installed via
#   `brew install k3d` (Homebrew required only in that case).
#
# What it does:
#   1. ensures the self-host images exist locally (omni-api:dev via `build`,
#      autopg:dev via `build-autopg`) — the dev overlay uses pullPolicy: Never;
#   2. creates a fresh disposable cluster under a temp KUBECONFIG (your
#      default kubeconfig/context is never touched) and imports the images;
#   3. `helm install --wait --timeout $(SMOKE_TIMEOUT)` with the self-host
#      overlay (values-dev.yaml);
#   4. asserts every pod is Ready and GET /health answers 200;
#   5. deletes the cluster in an EXIT trap — the target exits non-zero when
#      any step (including the install) fails, and teardown still runs.
#
# k3d is preferred: k3s ships servicelb, so the dev overlay's LoadBalancer
# Services get an IP and `helm --wait` completes. kind has no LB provider, so
# on kind the smoke overrides service.type=ClusterIP + nats.externalAccess=false
# (everything else keeps the values-dev self-host shape).
#
# Variables:
#   SMOKE_CLUSTER  cluster name                     (default omni-smoke)
#   SMOKE_TIMEOUT  helm --wait timeout              (default 10m)
#   SMOKE_PORT     host port for the /health check  (default 18882)
#   SMOKE_SET      extra helm args, e.g. failure-injection overrides
# -----------------------------------------------------------------------------
SMOKE_CLUSTER ?= omni-smoke
SMOKE_TIMEOUT ?= 10m
SMOKE_PORT    ?= 18882
SMOKE_SET     ?=

.PHONY: deploy-smoke
deploy-smoke: ## End-to-end self-host install on a disposable k3d/kind cluster
	@set -euo pipefail; \
	docker info >/dev/null 2>&1 || { echo "deploy-smoke: docker daemon is not running" >&2; exit 1; }; \
	for t in helm kubectl; do \
	  command -v $$t >/dev/null || { echo "deploy-smoke: missing required tool: $$t" >&2; exit 1; }; \
	done; \
	if command -v k3d >/dev/null; then provider=k3d; \
	elif command -v kind >/dev/null; then provider=kind; \
	else \
	  echo "deploy-smoke: neither k3d nor kind found — installing k3d via Homebrew…"; \
	  command -v brew >/dev/null || { echo "deploy-smoke: brew not found; install k3d or kind manually" >&2; exit 1; }; \
	  brew install k3d; provider=k3d; \
	fi; \
	docker image inspect $(IMAGE_REF) >/dev/null 2>&1 || \
	  docker buildx build --platform $(PLATFORM) -f $(CURDIR)/Dockerfile -t $(IMAGE_REF) --load $(ROOT); \
	docker image inspect autopg:dev  >/dev/null 2>&1 || \
	  docker buildx build --platform $(PLATFORM) -f $(CURDIR)/autopg.Dockerfile -t autopg:dev --load $(CURDIR); \
	export KUBECONFIG="$$(mktemp "$${TMPDIR:-/tmp}/omni-smoke-kubeconfig.XXXXXX")"; \
	cleanup() { rc=$$?; \
	  echo "deploy-smoke: tearing down cluster $(SMOKE_CLUSTER) (exit=$$rc)…"; \
	  if [ "$$provider" = k3d ]; then k3d cluster delete $(SMOKE_CLUSTER) >/dev/null 2>&1 || true; \
	  else kind delete cluster --name $(SMOKE_CLUSTER) >/dev/null 2>&1 || true; fi; \
	  rm -f "$$KUBECONFIG"; exit $$rc; }; \
	trap cleanup EXIT; \
	echo "deploy-smoke: creating disposable $$provider cluster $(SMOKE_CLUSTER)…"; \
	extra_set=""; \
	if [ "$$provider" = k3d ]; then \
	  k3d cluster delete $(SMOKE_CLUSTER) >/dev/null 2>&1 || true; \
	  k3d cluster create $(SMOKE_CLUSTER) --k3s-arg '--disable=traefik@server:0' \
	    --kubeconfig-update-default=false --kubeconfig-switch-context=false \
	    --wait --timeout 180s; \
	  k3d kubeconfig get $(SMOKE_CLUSTER) > "$$KUBECONFIG"; \
	  echo "deploy-smoke: importing local images (omni-api is ~2.6GB — takes a minute)…"; \
	  k3d image import $(IMAGE_REF) autopg:dev -c $(SMOKE_CLUSTER); \
	else \
	  kind delete cluster --name $(SMOKE_CLUSTER) >/dev/null 2>&1 || true; \
	  kind create cluster --name $(SMOKE_CLUSTER) --kubeconfig "$$KUBECONFIG" --wait 180s; \
	  kind load docker-image $(IMAGE_REF) autopg:dev --name $(SMOKE_CLUSTER); \
	  extra_set="--set service.type=ClusterIP --set nats.externalAccess=false"; \
	fi; \
	helm dependency build $(CHART); \
	echo "deploy-smoke: helm install (self-host overlay, --wait $(SMOKE_TIMEOUT))…"; \
	helm install $(RELEASE) $(CHART) \
	  --namespace $(NAMESPACE) --create-namespace \
	  -f $(CHART)/values-dev.yaml $$extra_set $(SMOKE_SET) \
	  --wait --timeout $(SMOKE_TIMEOUT); \
	echo "deploy-smoke: asserting all pods Ready…"; \
	kubectl -n $(NAMESPACE) get pods; \
	kubectl -n $(NAMESPACE) get pods --field-selector=status.phase!=Succeeded,status.phase!=Failed -o name \
	  | xargs kubectl -n $(NAMESPACE) wait --for=condition=Ready --timeout=180s; \
	echo "deploy-smoke: GET /health through port-forward…"; \
	kubectl -n $(NAMESPACE) port-forward svc/$(RELEASE) $(SMOKE_PORT):$(PORT) >/dev/null 2>&1 & pf_pid=$$!; \
	ok=""; \
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
	  sleep 2; \
	  if curl -fsS "localhost:$(SMOKE_PORT)/health" >/dev/null 2>&1; then ok=1; break; fi; \
	done; \
	kill $$pf_pid 2>/dev/null || true; \
	[ -n "$$ok" ] || { echo "deploy-smoke: /health never returned 200" >&2; exit 1; }; \
	echo "deploy-smoke: PASS — self-host stack (values-dev.yaml) installed end-to-end on $$provider"
