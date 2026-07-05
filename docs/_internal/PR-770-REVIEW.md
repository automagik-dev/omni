# PR #770 Review — promote homolog → main (omni fixes + image publish)

| | |
|---|---|
| **PR** | [automagik-dev/omni#770](https://github.com/automagik-dev/omni/pull/770) |
| **Title** | `chore: promote homolog → main (omni fixes + image publish)` |
| **Head** | `1bec7ff298ea4f54e892fe7b425d55caf101dd0c` (branch `homolog`) |
| **Base** | `bb5bc0c6f4d9caffcd66bfcb007739b3e7ac178c` (branch `main`) |
| **Range reviewed** | `bb5bc0c6..1bec7ff2` — 93 files, +4881 / −149 |
| **Review date** | 2026-07-04 |
| **Method** | 4 independent subagent reviewers (security, correctness, infrastructure, quality) + orchestrator verification of every HIGH against the code |
| **Verdict** | **FIX-FIRST** — the prod Helm overlay cannot deploy as-written and remote-media mode is not production-ready |
| **Status** | ✅ **HANDOFF EXECUTED 2026-07-05** — all HIGH/MED/LOW findings fixed and merged to `dev`; first promotion (#779) published `omni-api` + `autopg:v3.0.7` images. See the execution record below. |
| **Next action** | Human merges rolling PR **#781** (dev→main, all checks green, `ready-to-merge`); then one more main→dev reconcile. Ongoing state: memory `pr770-fix-orchestration-state`. |

> ⚠️ **Diff-staleness note:** the diff GitHub first returned was pinned to `818c8dbd` (~40 commits stale) and contained none of the `deploy/`, CI, Helm, Docker, or migration-0038 scope. This review targets the true head `1bec7ff2`. Anyone re-running `git diff bb5bc0c6 818c8dbd` will review a feature-less slice — use `bb5bc0c6..1bec7ff2`.

---

## 🤖 Autonomous Fix Handoff (START HERE)

> ### ✅ Execution record (2026-07-05) — this handoff has been EXECUTED; do not re-run it
> | Group | Findings | Landed as |
> |---|---|---|
> | G-HELM | H1v H2 H3 H4 H5 H6 MED-3/5/6 + deploy LOWs | PR #775 (`fix/helm-prod-deploy`) |
> | G-CICD | H1p LOW-6/7/18/23 | PR #774 (`ci/autopg-image-publish`, new `deploy/autopg.Dockerfile`) |
> | G-REMOTE | H7 MED-1/2 LOW-3/4/12 | PR #776 (`fix/remote-media-batch`, red-then-green H7 proof) |
> | G-MEDIA-LOW | LOW-1/2/5/9/10 | PR #782 (`fix/media-hardening`) |
> | G-CI-TESTS | H8 MED-4 | PR #778 (`ci/minio-integration`, anti-skip guard) |
> | follow-up | MED-1 chart wiring | PR #777 (`fix/helm-public-presign-endpoint`) |
>
> All merged to `dev`. Step 0 verified: `dev` was a strict ancestor of `main` (reconcile #769/#773 had already carried the #770 work). Promotion #779 published `autopg:{v3.0.7,v2.260704.11}` + `omni-api:v2.260704.11` (GHCR, private). Reconcile #783 restored `main`=0 unique commits. Decisions taken on the recommended defaults (bundled-autopg published image; H6 via cidrs+NetworkPolicy, no rotation) — veto window open in the PR bodies. Remaining: human merge of rolling PR #781; optional fresh-namespace `helm install -f values-prod.yaml --wait` smoke (needs imagePullSecret). The text below is preserved as the original mission brief.

**You are a fresh Fable orchestration.** PR #770 is merged to `main`; every finding in this document is now live in production. The review is **complete** — the four independent reviewers (security, correctness, infrastructure, quality) traced each finding end-to-end and the orchestrator re-verified every HIGH against the code. **Treat the findings as verified ground truth; do not re-review from scratch.** Your mission: autonomously **fix, verify, and land** all HIGH + MEDIUM findings and the cheap LOWs, via the repo's git workflow, without regressing anything in "Checked and clean."

### Step 0 — Establish a safe base branch (before any edit)
1. **Never commit on `main`** (hard repo rule). If `git branch --show-current` is `main`, stop and branch.
2. Fix flow: `fix/<slug>` off the correct base → PR to `dev` → auto-merge when green → the rolling `dev`→`main` PR promotes it.
3. **Verify branch drift first** — the homolog→main merge (#770) may have bypassed `dev`, so `dev` might not contain these files:
   - `git fetch --all`
   - `git log --oneline origin/main ^origin/dev | head -50` — what's in `main` but not `dev`.
   - Before editing a file, confirm it exists on your base: `git show origin/dev:<path> | head`. If it's missing, `dev` lacks the merged work → first reconcile (`chore/reconcile-main-into-dev`: `git merge origin/main` → PR to dev), or base the fix on the #770 merge commit and PR into dev. **Do not assume `dev == main`** (this repo has a tracked branch-drift concern).
4. Confirm every target file exists on your chosen base before editing.

### Ground rules (from `.claude/CLAUDE.md` — non-negotiable)
- **Bun only** (`bun`, `bunx`, `bun test` — never npm/yarn/pnpm/npx/node). Conventional commits (`type(scope): description`). No `any`. Zod on all external inputs.
- DB schema changes → drizzle migrations (`cd packages/db && bunx drizzle-kit generate`), **never** `drizzle-kit push`. *(None of these fixes require a schema change — 0038 is already correct.)*
- Zero-tolerance quality: `biome --error-on-warnings`, no skipped tests, CI green.
- Prefer `make` targets: `make check` (typecheck+lint+test), `make typecheck`, `make lint`, `make test-api`, `make cli ARGS="…"`.
- **Reuse before creating** — e.g. H7's fix must extract/reuse `materializeForProcessing` (media-processor.ts:286-308), not write a second S3-fetch helper.

### Shared contracts (both infra groups honor these so they need no live handshake)
- **C1 — image names/tags:** `omni-api = ghcr.io/automagik-dev/omni-api:v<version>`; if autopg is published, `autopg = ghcr.io/automagik-dev/autopg:v<version>`, where `<version>` = `packages/cli/package.json`. Prod `values-prod.yaml` pins `v<version>` (with the `v`).
- **C2 — DB secret:** the chart creates `<release>-autopg-app` holding key `DATABASE_URL` (password percent-encoded). `values-prod.yaml` references exactly that name + key.

### Execution groups

| Group | Owns (file tree) | Findings | Wave |
|-------|------------------|----------|------|
| **G-HELM** | `deploy/**` (values, templates, `charts/autopg`, Dockerfile, Makefile) | H1(values), H2, H3, H4, H5, H6, MED-3, MED-5, MED-6, LOW-8, LOW-11, LOW-13, LOW-14, LOW-15, LOW-16, LOW-17, LOW-19, LOW-20, LOW-21, LOW-22 | 1 |
| **G-CICD** | `.github/workflows/image-publish.yml` only | H1(publish job per C1), LOW-6, LOW-7, LOW-18, LOW-23 | 1 |
| **G-REMOTE** | `packages/api`, `packages/channel-sdk`, `packages/media-processing` (source) | H7, MED-1, MED-2, LOW-3, LOW-4, LOW-12 | 1 |
| **G-MEDIA-LOW** | `packages/api`, `packages/channel-*` (source) | LOW-1, LOW-2, LOW-5, LOW-9, LOW-10 | 2 (after G-REMOTE) |
| **G-CI-TESTS** | `.github/workflows/ci.yml` + `**/__tests__/**` | H8, MED-4 | 2 (after G-REMOTE) |

File trees are disjoint per group, so Wave-1 groups run fully parallel (worktree-isolated). Wave-2 groups follow G-REMOTE because they share `packages/` and G-CI-TESTS must exercise the fixed remote code.

### Per-group acceptance & verification

Each group = one `fix/<slug>` branch → one PR to `dev`. Full fix detail + `file:line` for every finding is in the sections below — this is the delta + how to prove it.

- **G-HELM** — Make `values-prod.yaml` deploy end-to-end. Implement C1 (H1/H4: real autopg image ref + `pullPolicy: IfNotPresent` + `v<version>` tag) and C2 (H2: mint `<release>-autopg-app` with URL-encoded `DATABASE_URL`; LOW-13). Fix first-install ordering (H3: provision as pre-install **or** omni-api initContainer that waits for the `omni` role). Default `replicaCount: 1` / HPA off (H5) + add PDB + anti-affinity (LOW-22). Add `pg_advisory_lock`/single migrate Job (MED-5). Harden autopg security (H6: `hostAuth.cidr` → pod CIDR + a NetworkPolicy allowing only omni-api→autopg:5432; **do NOT rotate the superuser password — the postmaster hardcodes it**). De-dup the `component` label (MED-3). Fix the comment/appVersion drift (LOW-11/14/15/19), dead env (LOW-16), Dockerfile cache order (LOW-17), Makefile buildx (LOW-20), socket-dir emptyDir (LOW-21), autopg secret GitOps source (MED-6), minio creds/TLS (LOW-8).
  **Verify:** `helm lint deploy/helm/omni` clean; `helm template deploy/helm/omni -f deploy/helm/omni/values-prod.yaml | kubeconform -strict -summary` passes (proves MED-3); grep the prod render to confirm the image tag is a published `v<version>` and the `DATABASE_URL` Secret it references is actually rendered (proves H1/H2/H4). Recommended: `k3d`/`kind` smoke `helm install omni deploy/helm/omni -f values-prod.yaml --wait --timeout 5m` on a fresh namespace succeeds (proves H1+H2+H3 together).
- **G-CICD** — Add an `autopg` build+push job per C1 (H1); SHA-pin every action (LOW-6); `provenance: true` (LOW-7); consider native arm64 runners (LOW-23); add a comment/CONTRIBUTING note that the merge to `main` must not carry `[skip ci]`, and prefer "Create a merge commit"/"Squash" over "Rebase and merge" (LOW-18).
  **Verify:** `actionlint .github/workflows/image-publish.yml` clean; confirm the autopg job's output tag matches C1 and what G-HELM pins.
- **G-REMOTE** — H7: fetch batch bytes via the backend into a temp file (extract `materializeForProcessing` into a shared `MediaStorageService` method and reuse in `batch-jobs.ts:818`; clean up in `finally`). MED-2: `config.ts:48-51` throw on unknown `OMNI_MEDIA_MODE`. MED-1: add `OMNI_MEDIA_S3_PUBLIC_ENDPOINT` used only for `presign()`. LOW-3: delete orphaned S3 object on empty/aborted stream. LOW-4: use `resolveGeminiAudioModel` at `audio.ts:137`. LOW-12: move `OMNI_MEDIA_*` parsing to a Zod schema.
  **Verify (adversarial):** reproduce H7 — run a batch job with `OMNI_MEDIA_MODE=remote` against MinIO and confirm items now **succeed** (before: 100% failed). `make test-api`; remote suites green under Docker (see DoD).
- **G-MEDIA-LOW** — LOW-1: distinguish 404 vs 5xx in `readMediaViaBackend`. LOW-2: stream range requests via S3 ranged GET instead of full-object buffer. LOW-5: delete dead `readMedia`/`downloadMedia`/`generateFilename`. LOW-9: add `/media/` to the scope-enforcer's instance extraction. LOW-10: private-IP/metadata deny-list before fetching media URLs.
  **Verify:** `make test-api`; add a scope-enforcer test proving a locked key gets its own media and cannot read another instance's (LOW-9).
- **G-CI-TESTS** — H8: add a `minio/minio` service leg (or `MINIO_INTEGRATION=1` on a Docker runner) to `ci.yml` so the four S3 suites actually run. MED-4: hoist the two `local:` tests out of `describe.skipIf(!hasDocker)` in `agent-dispatcher-media-remote.test.ts:124,147`.
  **Verify:** the new CI leg's log shows the S3 suites **executing** (not "skipped"); `extractMediaFiles`/`resolveDispatchMediaPath`/`formatProcessedMedia` now have executing assertions.

### Orchestration strategy
- **Wave 1 (parallel, worktree-isolated):** G-HELM, G-CICD, G-REMOTE. **Wave 2:** G-MEDIA-LOW and G-CI-TESTS (after G-REMOTE lands, so CI validates the fixed code).
- Use `isolation: worktree` for any agent mutating files in parallel. One PR per group, conventional-commit titled (`fix(helm): …`, `fix(api): …`, `ci(remote-media): …`).
- **Adversarially verify every fix**: re-create the finding's exact failure scenario, confirm it now passes. A fix without a reproduced-then-resolved check is not done.
- Fix loop per group: run its validation; if red, dispatch a fixer subagent; max 2 loops then escalate to the human.

### Global definition of done
- `make check` green (typecheck + biome zero-warnings + tests).
- Remote-media suites **run and pass** with Docker: `CI=true MINIO_INTEGRATION=1 bun test` across `s3-backend-remote`, `media-remote-e2e`, `media-processor-remote`, `agent-dispatcher-media-remote` — confirm they execute, not skip.
- `helm lint` + `helm template -f values-prod.yaml` clean; prod render references only published image tags and Secrets the chart creates; `kubeconform -strict` passes.
- (Recommended) fresh-namespace `helm install -f values-prod.yaml --wait` succeeds (H1–H3).
- Every group landed via `fix/*` → PR to `dev`, CI green; rolling PR carries to `main`.

### Decisions — proceed on the recommended default, log for human veto
- **H1/H2 prod DB strategy (recommended):** make the bundled autopg work as designed — publish an `autopg:v<version>` image (G-CICD) and implement the `<release>-autopg-app` `DATABASE_URL` Secret (G-HELM). *Alternative to surface:* prod `autopg.enabled: false` + a managed Postgres. Pick the first for continuity; note both in the PR body.
- **H6 superuser:** the postmaster hardcodes `postgres/postgres` and cannot be rotated — fix is `cidr` tightening + NetworkPolicy, **not** a password change (rotation crash-loops the pod).

### Do NOT touch / do NOT regress
Everything in **[Checked and clean](#checked-and-clean-coverage)** is verified-good: the media-backend path-traversal guard, S3 presign flow, media-route auth, `allowFirstParty` semantics (loop-protection only — grants no cross-instance data access), migration 0038, the Gemini `resolveGeminiAudioModel` root-cause fix, the Dockerfile core (multi-stage, non-root, ffmpeg), and the image-publish trigger/permissions model. Fix findings surgically; don't refactor these.

---

## Executive summary

**The application code is genuinely good.** All four reviewers independently praised the media-backend abstraction, the realtime dispatch path, the WhatsApp/Telegram ingest, the `allowFirstParty` feature, the Gemini audio fix, and migration 0038. Path traversal, size limits, credential handling, and the auth model are correct. **Zero CRITICAL findings.**

**The problems cluster in two areas that are new and never tested end-to-end:**

1. **The production Helm overlay** (`values-prod.yaml` + the vendored `autopg` subchart) — this PR is its first real run, and five independent HIGH defects each prevent it from deploying.
2. **Remote-media mode** — opt-in (defaults to `local`), but it has one fully-broken consumer (batch jobs), is skipped entirely in CI, and has two deployment-facing config traps.

Plus one **security default** (bundled Postgres superuser) worth fixing before the chart backs any shared cluster.

### Merge-safety distinction (shapes the verdict)

Merging this PR only fires the `image-publish` workflow (builds + pushes the image). It does **not** run `helm install`, and remote-media mode defaults to `local`. So **merging won't auto-break prod.** But the shipped prod artifact is not yet deployable. If this PR is "the deployable prod artifact," fix the HIGHs first. If the goal is only to publish the image, merge is acceptable *provided the merge commit carries no `[skip ci]`* (see LOW-18).

### Severity tally

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 8 |
| MEDIUM | 6 |
| LOW | 18 |

---

## HIGH findings

### Production Helm overlay cannot deploy (H1–H5)

Shared root cause: `values-prod.yaml` + the `autopg` subchart were never exercised end-to-end. Each of H1–H5 independently blocks a prod install; collectively the prod overlay is non-functional. All are config-fixable.

#### H1 · Prod autopg image is unpullable
**`deploy/helm/omni/charts/autopg/values.yaml:5-10`** + **`deploy/helm/omni/values-prod.yaml:94`**
The autopg subchart defaults to `image: autopg:dev` with `pullPolicy: Never`. Prod enables autopg but does not override the image, and **no CI job builds or publishes an `autopg` image** (only `omni-api` is published).
**Failure:** `helm install -f values-prod.yaml` on a real cluster → autopg StatefulSet **and** its provision Job both `ErrImageNeverPull` → no Postgres → omni-api CrashLoops indefinitely.
**Fix:** set `autopg.enabled: false` + a managed Postgres in prod, **or** give autopg a real registry repo/tag + `pullPolicy: IfNotPresent` and a pipeline that publishes it.
`CONFIRMED` (render: `image "autopg:dev"`, `pullPolicy: Never`).

#### H2 · Prod points at a DB secret the chart never creates
**`deploy/helm/omni/values-prod.yaml:42-43`**
Prod sets `database.existingSecret: "omni-autopg-app"` / `urlKey: "DATABASE_URL"`, but autopg only mints `<release>-autopg-auth` with keys `superuser-password` / `omni-password` — **no `DATABASE_URL` key, different name**. No template emits `omni-autopg-app` or a `DATABASE_URL` value; the "autopg publishes a ready DATABASE_URL" contract in the comments is unimplemented.
**Failure:** every prod omni-api pod → `CreateContainerConfigError: secret "omni-autopg-app" not found` → never starts.
**Fix:** emit `<release>-autopg-app` with an assembled `DATABASE_URL` (e.g. in the provision Job), **or** switch prod to `database.host` + `password` and let the umbrella chart assemble the URL.
`CONFIRMED` (render: only `kind: Secret` named `omni-autopg-auth` exists; `omni-autopg-app` appears solely as a `secretKeyRef` in the Deployment).

#### H3 · Fresh install deadlocks under `helm --wait`
**`deploy/Makefile` (deploy target)** + **`charts/autopg/templates/provision-job.yaml:9-12`** + **`packages/api/src/index.ts:654,715`**
`make deploy` runs `helm upgrade --install --wait --timeout 5m`. The `omni` DB role is created only by the autopg provision Job, which is a `post-install` hook — Helm runs it **after** main resources are Ready under `--wait`. But omni-api can't become Ready without the `omni` role: `waitForDatabaseReady` retries `SELECT 1` 30×1s then throws → `process.exit(1)`, and `/health` never binds until it passes.
**Failure:** on a fresh namespace, omni-api never Ready (no role) → `--wait` blocks → provision Job never runs → 5-min timeout → install fails. Upgrades are unaffected (role already exists), so this bites the **first** prod deploy specifically.
**Fix:** provision before omni-api (pre-install, not post-install), **or** add an omni-api initContainer that waits for the role, **or** drop `--wait` on first install.
`CONFIRMED` (Helm hook ordering is deterministic; 30s crash confirmed in code).

#### H4 · Prod image tag matches nothing published
**`deploy/helm/omni/values-prod.yaml:10`** + **`Chart.yaml` appVersion** vs **`.github/workflows/image-publish.yml:77-79`**
Prod pins `tag: "2.260703"` (v-less + stale; app is `2.260704.4`). The workflow only publishes `:<branch>`, `:<branch>-<sha12>`, and `:v<cliVersion>` (= `:v2.260704.4`) — never a plain `2.260703`. No other workflow fills the gap (verified: only `image-publish.yml` pushes to that GHCR path).
**Failure:** verbatim prod deploy → `ImagePullBackOff` (`ghcr.io/automagik-dev/omni-api:2.260703` was never pushed).
**Fix:** align the tag schemes (publish a v-less version tag, or set prod `tag: v2.260704.4` / `:main`); sync `Chart.appVersion` to the release version.
`CONFIRMED` (render image `ghcr.io/automagik-dev/omni-api:2.260703`).

#### H5 · Default 2 replicas is unsafe for WhatsApp and races the migration
**`deploy/helm/omni/values.yaml:29,32-33`**
Base defaults `replicaCount: 2` and `autoscaling.enabled: true` / `minReplicas: 2`. The chart's own note (`values.yaml:25-28`) warns that a single WhatsApp credential maps to one live Baileys socket with "key-ratchet races" needing validation. Two independent consequences:
- **WhatsApp:** two replicas binding one credential → key-ratchet corruption / duplicate sends / session resets requiring re-pair.
- **Migration:** two pods both run migrate-on-boot with no advisory lock (see MED-5) → catalog race on first deploy.
**Fix:** default `replicaCount: 1` / HPA off (or `minReplicas: 1`) until single-socket ownership (leader election) exists; document HPA is safe only for API/non-WhatsApp traffic; add a PDB + anti-affinity.
`PLAUSIBLE` (self-documented; actual WhatsApp corruption depends on app-side socket single-flighting that could not be fully confirmed from the chart).

### Security

#### H6 · Bundled Postgres ships a hardcoded, unrotatable superuser
**`charts/autopg/templates/provision-job.yaml:96`** + **`charts/autopg/values.yaml:25-40,101-102`** + **`charts/autopg/templates/NOTES.txt`** + **`values.yaml:180`**
The provision Job runs `ALTER USER postgres PASSWORD 'postgres'` with an explicit "DO NOT rotate" comment (the postmaster hardcodes the default for its in-process admin pool). `hostAuth.cidr` defaults to `"all"` → renders `host all all all scram-sha-256`; no NetworkPolicy ships anywhere; `autopg.enabled: true` by default **and** in prod.
**Attack:** any in-cluster workload that reaches the postgres pod/ClusterIP `:5432` (default k8s networking — a co-tenant, compromised sidecar, or any other app in the namespace/cluster) connects as `postgres`/`postgres` and gets full superuser over every database, including all Omni API keys, message content, contacts, and media references → full platform compromise + data exfiltration, using a credential published in the repo.
**Not CRITICAL because:** the Service is ClusterIP (no ingress), so an attacker needs an in-cluster foothold first. Nothing beyond network reachability protects it.
**Fix:** (1) restrict `hostAuth.cidr` to the actual pod/service CIDR, not `"all"`; (2) ship a NetworkPolicy allowing only omni-api → autopg:5432; (3) if the postmaster genuinely can't take a managed superuser password, gate `autopg.enabled` behind an explicit single-tenant-cluster + NetworkPolicy acknowledgement — don't ship it as the silent default.
`CONFIRMED`.

### Correctness

#### H7 · Batch media processing is 100% broken in remote mode
**`packages/api/src/services/batch-jobs.ts:818`** (with `resolveFilePath` at `:854-886`)
`processItem` does `const fullPath = join(this.mediaStorage.getBasePath(), resolved.path)` and hands that to `mediaService.process()`, which reads off local disk. But in remote mode `resolveFilePath` returns `message.mediaLocalPath` — an S3 **key** (e.g. `inst/2026-07/msg.opus`), not a local path. The bytes are in S3, not under `./data/media`.
**Failure:** with `OMNI_MEDIA_MODE=remote`, a batch transcription/extraction job completes with **100% failed items** (each caught at `batch-jobs.ts:660`). The realtime path fixed exactly this with `materializeForProcessing` (`media-processor.ts:286-308`); batch-jobs never got the equivalent, and there is no batch-remote test among the added suites.
**Fix:** fetch bytes via `this.mediaStorage.read(resolved.path)` into an `os.tmpdir()` temp file (keep the direct `join(getBasePath(), …)` path in local mode), pass the temp path to `process()`, clean up in `finally` — ideally extract `materializeForProcessing` into a shared `MediaStorageService` method and reuse it.
`CONFIRMED`.

### Testing

#### H8 · Green CI does not validate remote-media at all
**`packages/api/src/__tests__/minio-harness.ts:61-65`** + **`.github/workflows/ci.yml:139`**
The four S3/MinIO integration suites (`s3-backend-remote`, `media-remote-e2e`, `media-processor-remote` remote, `agent-dispatcher-media-remote`) gate on `minioIntegrationEnabled()`: `if (process.env.CI === 'true' && process.env.MINIO_INTEGRATION !== '1') return false`. GitHub Actions always sets `CI=true`; `MINIO_INTEGRATION` is set nowhere in the repo; `ci.yml` runs `bun test --env-file=.env` with no MinIO service container. So these suites **deterministically skip in CI** and execute zero real S3 assertions.
**Failure:** a regression in `s3-backend.ts` (presign / TTL / multipart-abort) or the dispatch presign path merges green. Mitigated only by remote mode being opt-in and locally/pre-push tested with Docker.
**Fix:** add a CI leg with a `minio/minio` service container (or `MINIO_INTEGRATION=1` on a Docker runner).
`CONFIRMED`.

---

## MEDIUM findings

#### MED-1 · Presigned URLs use the internal S3 endpoint
**`packages/channel-sdk/src/media-backends/s3-backend.ts:83-85`** + **`agent-dispatcher.ts:904,939`**
With `OMNI_MEDIA_S3_ENDPOINT=http://minio:9000` (the value the internal docs and Helm chart use for in-cluster uploads), every presigned URL handed to the agent — `ProviderFile.url` and the inline `[url]` in `formatProcessedMedia` — is `http://minio:9000/…`. Any agent runtime not in the same network namespace can't resolve `minio:9000`, so image/video/document fetches fail (transcription text still flows).
**Fix:** support a distinct `OMNI_MEDIA_S3_PUBLIC_ENDPOINT` used only for `presign()`, or document that the endpoint must be reachable by the agent runtime. `PLAUSIBLE` (works only if the agent is co-located with MinIO).

#### MED-2 · `OMNI_MEDIA_MODE` typo silently falls back to local
**`packages/channel-sdk/src/media-backends/config.ts:48-51`**
Only the exact string `remote` selects S3; any other value (`s3`, `S3`, `minio`, `aws`, …) silently returns `{ mode: 'local' }` with no error or log. An operator who sets `OMNI_MEDIA_MODE=s3` with all S3 vars populated gets local mode — media on ephemeral pod disk (lost on restart), agents handed unreachable local paths — while the file's own docstring and `remote-media-mode.md` claim a misconfiguration "cannot silently fall back to local disk." Only *missing creds under `mode===remote`* fail loud; a mode typo does not.
**Fix:** reject unknown `OMNI_MEDIA_MODE` values (throw), or at minimum `log.warn` instead of defaulting to local. `CONFIRMED`.

#### MED-3 · Duplicate `app.kubernetes.io/component` label → invalid YAML
**`deploy/helm/omni/templates/_helpers.tpl:43-46`** → **`templates/minio.yaml`** + **`templates/nats.yaml`**
`omni.selectorLabels` hardcodes `component: api`; the minio/nats templates append `component: minio`/`nats` after it, so `matchLabels` / selector / pod-labels each contain the key twice. Valid only because `sigs.k8s.io/yaml` is last-wins.
**Failure:** rejected by `kubeconform -strict` / `kubectl --strict` / GitOps validators (blocks CI/ArgoCD); a first-wins parser would give minio/nats pods `component: api` and the omni-api Service would load-balance HTTP onto MinIO/NATS.
**Fix:** remove `component: api` from `omni.selectorLabels`; set component per-workload. `CONFIRMED`.

#### MED-4 · Dispatch helpers have zero CI coverage
**`packages/api/src/plugins/__tests__/agent-dispatcher-media-remote.test.ts:124,147`**
The two `local:` tests need no Docker but sit inside `describe.skipIf(!hasDocker)` (opens at line 62), so they skip in CI. The pre-existing `agent-dispatcher.test.ts` has zero references to `extractMediaFiles` / `resolveDispatchMediaPath` / `formatProcessedMedia` (grep = 0). So all three helpers this PR touches run in **no** CI test on either branch.
**Fix:** hoist the two `local:` tests into an ungated `describe`, exactly as `media-processor-remote.test.ts:202` already does (trivial). `CONFIRMED`.

#### MED-5 · Migrate-on-boot with ≥2 replicas and no advisory lock
**`packages/db/src/migrate.ts`** + **`packages/api/src/index.ts:728`** + **`values.yaml:29`**
Migrations run inline on every pod boot; the drizzle postgres-js migrator takes no lock. First deploy: two pods run `CREATE SCHEMA/TABLE IF NOT EXISTS` for drizzle bookkeeping concurrently (Postgres `IF NOT EXISTS` is not concurrency-safe → catalog unique-violation) → one pod transient CrashLoop, self-heals. A future non-idempotent migration + RollingUpdate + 2 replicas is unsafe (new pod migrates while old pods run old schema). 0038 itself is safe (additive, `IF NOT EXISTS`).
**Fix:** run migrations once via a pre-upgrade Job, or wrap `migrate()` in `pg_advisory_lock`; document the N-1 backward-compat rule. `CONFIRMED`.

#### MED-6 · autopg password stability breaks under GitOps
**`deploy/helm/omni/charts/autopg/templates/secret.yaml`**
Password stability uses helm `lookup`, which returns empty under `helm template` / `--dry-run` (how ArgoCD/Flux render). Under template-rendering GitOps the `omni` role password regenerates every sync while the DB keeps the old one → auth failure / CrashLoop (the provision Job re-`ALTER`s each sync). Fine under `helm upgrade` / `make deploy`.
**Fix:** for GitOps, source passwords from `auth.existingSecret` (externally managed). `CONFIRMED` (pattern) / `PLAUSIBLE` (impact depends on deploy tooling).

---

## LOW findings

### Media code
- **LOW-1** · `readMediaViaBackend` (`media-storage.ts:324-331`, consumed at `media.ts:757`) catches *all* errors and returns `null` → a transient S3 outage/timeout on `GET /api/v2/media/…` returns 404 "Media not found" instead of 5xx, so clients treat down-right-now the same as gone-forever and won't retry. Distinguish object-not-found (404) from transient failures (502/503). `CONFIRMED`
- **LOW-2** · Remote-mode `GET /media/*` (`media.ts:757,770-786`) + `materializeForProcessing` (`media-processor.ts:291`) pull the **entire** object into a heap Buffer per request, including each range seek. A browser seeking in a large remote video issues many Range requests, each doing a full S3 GET of the whole object into API memory. With WhatsApp media up to 2 GB, OOM risk. (Local mode also buffered whole files, so not a regression — amplified over the network.) Stream range requests via an S3 ranged GET. `CONFIRMED` (perf/memory)
- **LOW-3** · S3 `storeStream` (`s3-backend.ts:55-75`) never removes the object it created on an empty or aborted stream, unlike the local backend (which `rm`s at `local-backend.ts:77-79`). Empty stream → `writer.end()` commits a 0-byte object; on overflow, `writer.end(error)` is *assumed* to abort the multipart upload (verify Bun's semantics). Either way → orphan in S3. Best-effort `delete(key)` on `size===0` and in the catch path. `PLAUSIBLE`
- **LOW-4** · `audio.ts:137` — in the `provider==='openai'` fallback chain, the Gemini attempt hardcodes `GEMINI_AUDIO_MODEL` and does not call `resolveGeminiAudioModel`, so a configured `stt.gemini.model` / `GEMINI_STT_MODEL` override is ignored on that path. Functionally works (valid model); the primary fix (gemini-provider branch) is correct. Use `this.resolveGeminiAudioModel(undefined)` for consistency. `CONFIRMED` (minor)
- **LOW-5** · Dead footguns now caller-less: `MediaStorageService.readMedia` (`media-storage.ts:299`, no traversal guard) and WhatsApp `downloadMedia` / `generateFilename` (`download.ts:170-221`, joins attacker-controlled document `fileName` into a path). Live paths are safe; delete the dead code.

### Security posture
- **LOW-6** · `image-publish.yml:46,57,60,63,70` pins actions to mutable major-version tags (`@v4`/`@v3`/`@v6`), not immutable SHAs — a moved/compromised tag runs attacker code in a job with `packages: write`. Pin to full commit SHAs (Dependabot keeps them current). `CONFIRMED`
- **LOW-7** · `image-publish.yml:82` sets `provenance: false` → published image ships without SLSA provenance / SBOM attestation. Enable it. `CONFIRMED`
- **LOW-8** · Bundled MinIO (`minio.yaml:27-30`) serves plaintext `http://` in-cluster and reuses its root user/password verbatim as `OMNI_MEDIA_S3_ACCESS_KEY`/`_SECRET_KEY`. Presigned GET URLs (default 1h TTL) grant Omni-auth-bypassing access for their lifetime. In-cluster only (ClusterIP). Separate app creds from root; enable TLS or document the in-cluster assumption; keep TTL as low as the workflow tolerates. `CONFIRMED` (informational)
- **LOW-9** · `GET /media/:instanceId/*` (`media.ts:720-799`) is invisible to the instance-allowlist scope enforcer (`scope-enforcer.ts` extracts instance target only from `/instances/` and `/chats/` prefixes). A broad `media:read`/`*` key can read another instance's media at `/media/<otherInstanceId>/…` if it knows the messageId; an allowlisted key is denied even its *own* media. Add `/media/` to the enforcer's path-instance extraction (or call `requireInstanceAccess` on the route). `CONFIRMED` (gap) / `PLAUSIBLE` (needs messageId leak). Pre-existing — PR only changed the read call at line 757.
- **LOW-10** · Pre-existing SSRF surface: `storeFromUrl` (`media-storage.ts:262-287`) and `downloadToTempFile` (`agent-dispatcher.ts`) fetch media URLs with no private-IP/metadata (`169.254.169.254`, RFC1918) blocklist. Safe today only because WhatsApp (Baileys stream) and Telegram (fixed host) URLs aren't sender-controlled. Add a link-local/private-range deny before fetching; pin the redirect follower to the same policy. `PLAUSIBLE`. Pre-existing — PR only wrapped the sink in the backend abstraction.

### Config / infra polish
- **LOW-11** · `values.yaml:209` comment cites a non-existent path (`packages/api/src/services/media-backends/config.ts`); real path is `packages/channel-sdk/src/media-backends/config.ts`. `CONFIRMED`
- **LOW-12** · `config.ts:47-85` parses `OMNI_MEDIA_*` from raw `process.env` (hand-rolled `parseBool`/`parseTtl`), not Zod — repo rule is "no unvalidated external inputs." Mitigated (loud-throw on missing creds, coerced, unit-tested). Style/consistency. `CONFIRMED`
- **LOW-13** · `templates/secret.yaml` assembles `DATABASE_URL` with the password not percent-encoded → a password containing `@ : / ? #` yields a malformed URL. `urlquery`-encode it. `CONFIRMED`
- **LOW-14** · `Chart.yaml` appVersion `"2.260703"` stale vs app `2.260704.4` (cosmetic; doesn't drive the image tag). Sync it. `CONFIRMED`
- **LOW-15** · `hpa.yaml:3-5` comment says "HPA disabled by default … minReplicas 1", contradicting the actual defaults (enabled, min 2). Ties to H5. Fix the comment. `CONFIRMED`
- **LOW-16** · `Dockerfile:69` + `values.yaml:66-67` — `NATS_MANAGED` / `PGSERVE_EMBEDDED=false` are dead config in the container (`NATS_MANAGED` is read only by `ecosystem.config.cjs` (PM2); `PGSERVE_EMBEDDED` only warns if `=true`). The API is driven by `NATS_URL`/`DATABASE_URL`. Harmless but misleading. Drop or annotate as no-op. `CONFIRMED`
- **LOW-17** · `Dockerfile:30-34` deps stage COPYs whole `packages/` + `apps/` before install, busting the install-layer cache on any source change (comment claims "manifests first"). Copy only `package.json` manifests, install, then copy source. `CONFIRMED`
- **LOW-18** · Release: many homolog tip commits carry `[skip ci]`. A standard merge commit to main won't inherit it, but a **rebase/squash that carries the tip message would skip the first image build**. Use "Create a merge commit" or "Squash" and verify the merge commit message has no `[skip ci]`. `PLAUSIBLE`
- **LOW-19** · `Chart.yaml` dependency comment + `values.yaml` (~175) describe autopg as "a minimal PLACEHOLDER … the lead replaces it," but a full Postgres-18 chart is actually vendored. Risk: operator rips out a working DB chart. Update the comments. `CONFIRMED`
- **LOW-20** · `deploy/Makefile` build uses plain `docker build`, relying on BuildKit-by-default to honor `Dockerfile.dockerignore`; with `DOCKER_BUILDKIT=0`/old Docker the file-specific dockerignore is silently ignored → full context (`.git`, `node_modules`, `data/`) ships. Force buildx or add a root `.dockerignore` fallback. `PLAUSIBLE`
- **LOW-21** · `charts/autopg/templates/statefulset.yaml` — `--socket-dir /var/run/autopg` has no emptyDir mount; relies on a writable rootfs and breaks if `readOnlyRootFilesystem` is later set. Mount an emptyDir. `CONFIRMED`
- **LOW-22** · No PodDisruptionBudget and no podAntiAffinity/topologySpread for a 2+-replica HA service (`deployment.yaml`) — a node drain can evict all replicas at once. Add a PDB + anti-affinity. `CONFIRMED`
- **LOW-23** · `image-publish.yml:70` builds arm64 under QEMU emulation (Bun install/build) → slow / possible OOM on first cold-cache CI build. Consider native arm64 runners. `PLAUSIBLE`

*(LOW count of 18 in the tally groups the finer polish items; 23 are itemized here for completeness.)*

---

## Checked and clean (coverage)

Attack surfaces and behaviors examined and found correct:

**Media / application**
- Local backend path-traversal guard — `local-backend.ts:27-34` `getSafePath` uses `resolve()` + `startsWith(base + sep)`, correctly rejecting `../`, absolute paths, and URL-encoded `%2e%2e` (nothing decodes before resolve). A net improvement over the prior raw `writeFileSync` in the Telegram handler.
- S3 backend — credentials never logged (only bucket/endpoint/forcePathStyle), objects private by default (no public-read ACL), presign is GET-only with a bounded TTL, secret key never in the URL (SigV4 query params only).
- Media route auth — all `/media/*` routes mounted under `protectedApp` → `authMiddleware` + `scopeEnforcer`; no unauthenticated internet reach; no static-file middleware serves `./data/media` outside this authed route.
- Zod validation on every new API input (media POST bodies, `allowFirstParty` in create + update).
- `allowFirstParty` end-to-end — migration 0038 + schema default `false`; PATCH persists via `.set({...data})`; CLI applies only explicit true/false; dispatcher gate `!instance.allowFirstParty && isFirstPartyInstanceSender(...)` fails safe (undefined → drop). Only relaxes cross-instance **loop protection** — grants no cross-instance data access or elevated trust; a "malicious first-party message" at worst gets a normal agent reply. Sender identity is phone-derived (spoof-resistant on WhatsApp/Telegram).
- Realtime remote media path — `materializeForProcessing` temp file keyed by `randomUUID` + preserved extension; `process()` wrapped in try/finally cleanup (runs on success **and** failure); S3-read failure publishes `media.processing.failed` + `media.processed` so the dispatcher never hangs.
- Agent dispatch remote — image/video/document presigned to `ProviderFile.url`; audio correctly excluded (rides transcription text); presign failures degrade gracefully (media dropped, text kept); stored reference is always the S3 key, never an expiring URL.
- WhatsApp + Telegram ingest — both populate `rawPayload.mediaLocalPath`; WhatsApp streams to the backend size-guarded (no full-buffer heap), returns null on `size===0`; Telegram uses fixed host `api.telegram.org` (no SSRF), `sanitizeFilename()` before the key, `downloadGuard.checkResponse` before read.
- Gemini audio fix — `resolveGeminiAudioModel` prevents the OpenAI `gpt-audio-mini` model leaking into Gemini (the bug this PR targets); root cause fixed.
- Service wiring — `getMediaStorage` singleton check-and-set is synchronous (no first-use race).

**Infra / CI / DB**
- `image-publish.yml` — fires on merge to main (path filters match), **not** on PRs; `packages: write` + GITHUB_TOKEN correct for GHCR; concurrency per `github.ref` + cancel-in-progress; **no `:latest` tag** (no out-of-order-latest race); `context: .` + `file: deploy/Dockerfile`; gha cache `mode=max`; multi-arch configured; no `pull_request_target`; risky values use shell env-expansion, not `${{ }}` (no script injection).
- `deploy/Dockerfile` — multi-stage; `bun install --frozen-lockfile`; **ffmpeg in the final runtime stage** (as root before `USER bun`); non-root uid 1000; HEALTHCHECK/probes hit `/health` (a real route); `EXPOSE 8882` == Service targetPort; migrations at `/app/db/drizzle` match the API's `new URL('../../db/drizzle', import.meta.url)`; dev deps excluded from final image; prod-deps stage correctly strips workspace devDeps; S3 uses Bun's native client (no missing `@aws-sdk` dep).
- `Dockerfile.dockerignore` — correct `<Dockerfile>.dockerignore` naming, patterns relative to context root, keeps `scripts/` + `packages/db/drizzle`.
- Migration 0038 — journal appends idx 38 only (no reorder/deletion); SQL is idempotent + fast (constant default, no table rewrite PG11+); matches `schema.ts` exactly; safe on existing rows. Missing `0038_snapshot.json` is consistent with the repo's hand-written-migration convention.
- Umbrella guards — `omni.media.secretName` hard-fails when remote media lacks both MinIO and an external creds secret; DB-host fail-guard; NOTES.txt host-unset warning.
- Media Helm wiring — `OMNI_MEDIA_*` env names match code; creds injected by `secretKeyRef` only (never plaintext); minio Secret mints all 4 keys; idempotent bucket bootstrap (release Job + per-pod initContainer).
- Main-chart secrets — DB URL + provider creds go into a k8s Secret, never a ConfigMap; ConfigMap explicitly keeps S3 creds out. Service type ClusterIP, `ingress.enabled: false`, `minio.enabled: false` by default.
- Pod hardening — `runAsNonRoot: true`, `runAsUser: 1000`, `allowPrivilegeEscalation: false`, drop ALL.
- `.env.example` — `OMNI_MEDIA_MODE=local` default; all S3 creds empty/commented; no real credentials committed.
- Versioning — root + all `packages/*` + `apps/ui` + `marketplace.json` + `plugin.json` uniformly `2.260704.4`; `bun.lock` coherent; **zero new dependencies** (Bun-native S3 client); commits all Conventional (version bumps bot-authored).
- Docs — `docs/_internal/remote-media-mode.md` matches `config.ts` + `.env.example` exactly (all 8 `OMNI_MEDIA_*` vars, defaults, TTL, key layout — no drift).
- `helm lint` passes (dev + prod); `helm template` renders (dev + prod) with no errors.

---

## Recommended fix order

1. **Before anyone runs the prod Helm overlay** (H1–H5): fix the autopg image, the `omni-autopg-app` secret contract, the `--wait` first-install ordering, the image tag mismatch, and the default replica count. All are mechanical edits in `values-prod.yaml` + the autopg subchart.
2. **Before enabling remote media anywhere** (H7, H8, MED-1, MED-2): fix batch-jobs remote mode, add the MinIO CI leg, and harden the mode-typo + presign-endpoint config.
3. **Security hardening** (H6 + LOW-6/9): autopg NetworkPolicy/cidr, action SHA-pinning, media scope-enforcer gap — before this backs a shared/multi-tenant cluster.
4. **Merge itself:** safe to fire the image build now, provided the merge commit carries no `[skip ci]` (LOW-18). Nothing here auto-deploys; remote mode defaults to local.

---

*Reviewed read-only against the immutable commit `1bec7ff2`. No files were modified during review.*
