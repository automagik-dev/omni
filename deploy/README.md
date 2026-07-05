# Omni Deployment

Omni ships as a single Helm umbrella chart — [`deploy/helm/omni`](helm/omni) —
deployed to three *realms*. Every realm installs the **same chart**; only the
values overlay changes. The bundled datastores (autopg Postgres, MinIO, NATS)
turn on or off per realm, so the chart covers both fully self-contained
self-hosting and Namastex's managed AWS clusters.

## Realm matrix

| Realm | Cluster | Values file | Images / channel | Database | Media | Who deploys |
|---|---|---|---|---|---|---|
| **dev** | Local k8s (OrbStack, k3d, kind, …) — the self-host shape | [`values-dev.yaml`](helm/omni/values-dev.yaml) | Locally built `omni-api:dev` + `autopg:dev` (`pullPolicy: Never`); tracks the `dev` branch you build from | Bundled **autopg** subchart (Postgres 18, in-cluster) | Bundled **MinIO** (in-cluster S3) | You — `make -C deploy deploy` |
| **homolog (HML)** | Dedicated AWS cluster | [`values-homolog.yaml`](helm/omni/values-homolog.yaml) | `ghcr.io/automagik-dev/omni-api` — `tag: ""` → `v<Chart.appVersion>`; the `:homolog` tag tracks the `homolog` branch | External **RDS** via pre-created Secret `omni-db` (`DATABASE_URL`) | Real **AWS S3** (`omni-media-hml`) via Secret `omni-media-s3` | Namastex |
| **HML co-tenant (ALB)** | Shared `langwatch-hml` EKS cluster (sa-east-1), namespace `omni-hml` | [`values-homolog.yaml`](helm/omni/values-homolog.yaml) **+** [`values-hml-alb.yaml`](helm/omni/values-hml-alb.yaml) delta (in that order) | `ghcr.io/automagik-dev/omni-api` — `v<Chart.appVersion>` from public GHCR (no pull secret) | Shared RDS instance, **own `omni` database** — `omni-db` Secret ESO-synced from Secrets Manager `/khal/omni/hml/db` | Real **AWS S3** (`nmstx-khal-omni-hml-media`, sa-east-1) — `omni-media-s3` Secret ESO-synced from `/khal/omni/hml/media-s3` | Namastex |
| **prod** | Dedicated AWS cluster (separate from HML) | [`values-prod.yaml`](helm/omni/values-prod.yaml) | `ghcr.io/automagik-dev/omni-api` — `tag: ""` → `v<Chart.appVersion>` (v-tags published on merge to `main`; `:main` also available) | External **RDS** via Secret `omni-db` (`DATABASE_URL`) | Real **AWS S3** (`omni-media`) via Secret `omni-media-s3` | Namastex |

Notes that apply across the matrix:

- **Promotion flow**: `dev` (local realm) → `homolog` branch (= the HML image
  channel) → `main` (= prod releases), via rolling PRs that a human merges.
- **homolog/prod require `--set ingress.host=<fqdn>`** — the overlays leave the
  host empty on purpose and the chart fail-fasts without it:

  ```bash
  make -C deploy deploy REALM=homolog HELM_EXTRA='--set ingress.host=omni-hml.example.com'
  make -C deploy deploy REALM=prod    HELM_EXTRA='--set ingress.host=omni.example.com'
  ```

- **HML co-tenant (ALB) deploy command** — the co-tenant realm rides on the
  shared `langwatch-hml` cluster, so ingress is the AWS Load Balancer
  Controller instead of nginx/cert-manager. Layer the ALB delta AFTER the
  homolog overlay and pass the ACM certificate ARN at deploy time (see the
  header of [`values-hml-alb.yaml`](helm/omni/values-hml-alb.yaml)):

  ```bash
  helm upgrade --install omni deploy/helm/omni -n omni-hml \
    -f deploy/helm/omni/values-homolog.yaml \
    -f deploy/helm/omni/values-hml-alb.yaml \
    --set ingress.host=hml.omni.khal.ai \
    --set 'ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=<acm-cert-arn>' \
    --wait
  ```

  The `omni-db` / `omni-media-s3` Secrets in `omni-hml` are materialized by
  External Secrets Operator from Secrets Manager `/khal/omni/hml/*` — do not
  create them by hand in this realm.

- **homolog/prod pre-created Secrets** (same namespace as the release; see the
  header comments in each values file for exact commands):
  - `omni-db` — key `DATABASE_URL`, the full RDS connection URL.
  - `omni-media-s3` — keys `OMNI_MEDIA_S3_ACCESS_KEY` + `OMNI_MEDIA_S3_SECRET_KEY`.
- **One replica per realm** — a WhatsApp credential maps to a single live
  Baileys socket; see the "replicas + scaling" notes in
  [`values.yaml`](helm/omni/values.yaml) before scaling out.

## Self-hosting (the supported OSS path)

**The bundled autopg + MinIO + NATS stack — the `values-dev.yaml` shape — IS
the supported self-host path.** You do not need AWS, RDS, or an S3 account to
run Omni: `autopg.enabled: true` gives you an in-cluster Postgres 18 with
scoped-role provisioning, `minio.enabled: true` gives you an in-cluster S3 for
media, and NATS/JetStream is bundled as first-party templates. The AWS
RDS + real-S3 shape (homolog/prod overlays) is **Namastex's cloud path**, not a
requirement — self-hosters only graduate to external datastores if they want
managed durability.

Quickstart on any local/self-managed cluster:

```bash
# 1. Build the images (or use the public GHCR images — see below)
make -C deploy build          # omni-api:dev
make -C deploy build-autopg   # autopg:dev

# 2. Install (defaults: REALM=dev → values-dev.yaml, namespace omni)
make -C deploy deploy

# 3. Check it
make -C deploy status
make -C deploy health
```

To skip local builds entirely, point the dev-shape install at the public
registry images instead:

```bash
helm upgrade --install omni deploy/helm/omni -n omni --create-namespace \
  -f deploy/helm/omni/values-dev.yaml \
  --set image.repository=ghcr.io/automagik-dev/omni-api \
  --set image.tag=v<version> --set image.pullPolicy=IfNotPresent \
  --set autopg.image.repository=ghcr.io/automagik-dev/autopg \
  --set autopg.image.tag=v3.0.7 --set autopg.image.pullPolicy=IfNotPresent
```

Adjust `ingress.host`, the dev-only passwords, and `service.type` in a copy of
`values-dev.yaml` for anything beyond a throwaway install.

### Public images — no pull secret

`ghcr.io/automagik-dev/omni-api` and `ghcr.io/automagik-dev/autopg` are
**public**. Pulling them needs no registry credentials of any kind:
`imagePullSecrets` stays `[]` in every overlay, and nothing in this repo will
ever ask you to configure registry auth for these images.

Provenance is verifiable — the publish workflow attaches SLSA provenance
attestations (GitHub-native, via `actions/attest-build-provenance`):

```bash
gh attestation verify oci://ghcr.io/automagik-dev/omni-api:v<version> -R automagik-dev/omni
```

Only images published after attestation support landed (July 2026) carry
these; older tags report "no attestations found".

### Proving the self-host path end-to-end

`deploy-smoke` spins up a fresh disposable k3d (or kind) cluster, imports the
locally built images, runs the full `values-dev.yaml` install with
`helm install --wait`, asserts every pod is Ready and `/health` answers, then
deletes the cluster — teardown runs even when the install fails, and the
target exits non-zero on failure:

```bash
make -C deploy deploy-smoke
```

Requires Docker running, `helm`, `kubectl`, and `k3d` or `kind` (auto-installs
k3d via Homebrew if neither is present). See the target header in
[`Makefile`](Makefile) for tunables (`SMOKE_TIMEOUT`, `SMOKE_SET`, …).

## Makefile reference

Run everything as `make -C deploy <target>` from the repo root.

| Target | What it does |
|---|---|
| `build` | Build `omni-api:dev` (BuildKit, repo-root context) |
| `build-autopg` | Build `autopg:dev` from `autopg.Dockerfile` |
| `deps` | `helm dependency build` (vendors the autopg subchart) |
| `lint` / `template` | Lint / render the chart with the selected realm overlay |
| `deploy` | `helm upgrade --install --wait` to namespace `$(NAMESPACE)` |
| `status` / `logs` / `health` | Rollout status, API logs, port-forward + `GET /health` |
| `smoke` | Run the image alone in Docker (no cluster) |
| `deploy-smoke` | Full disposable-cluster install proof (see above) |
| `uninstall` | Remove the release |

Key variables: `REALM=dev|homolog|prod` picks the values overlay
(`VALUES=…` still overrides it directly); `HELM_EXTRA='--set …'` appends
arbitrary helm args (required for homolog/prod ingress hosts);
`NAMESPACE`/`RELEASE` default to `omni`.
