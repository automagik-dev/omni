# Omni Admin (`@omni/khal-ui`)

A KHAL OS pack that admins the Omni messaging platform, plus the BFF and Vite
harness needed to develop it against a live Omni backend.

This is the **vertical skeleton** (Group A): a booting KHAL app + BFF + harness +
typed client, driven by a generated capability inventory. Group B builds the full
view surface on top.

## Layout

```
apps/khal-ui/
├── khal-app.json                 # KHAL install manifest (validated by @khal-os/types)
├── schemas/app-settings.schema.json
├── scripts/
│   ├── build-capability-inventory.ts   # merges route-census sources → capabilities.json
│   ├── openapi.snapshot.json           # vendored OpenAPI snapshot (build input)
│   └── dev.ts                          # runs BFF + harness together
├── package/                      # @omni/khal-ui-pack  — the React pack (tsup build)
│   └── src/
│       ├── manifest.ts           # pack manifest (default export)
│       ├── views/main/MainView.tsx
│       ├── api/{client,ext}.ts   # typed data layer (SDK + off-spec helpers)
│       └── capabilities/         # capabilities.json (generated) + typed accessor
├── service/                      # @omni/khal-ui-service — the BFF (Bun.serve)
│   └── src/{bff.ts,index.ts}
└── dev/                          # @omni/khal-ui-dev — Vite harness (port 5174)
    └── src/{main.tsx,sdk-shim.tsx,styles.css}
```

## Setup

### Distribution and credential boundary

The canonical UI uses **prebuilt-artifact distribution** (model (c) in
`.genie/wishes/canonical-ui-consolidation/DECISION-khalos.md`). The source pack
imports private, Elastic-2.0-licensed `@khal-os/*` packages from
`git.namastex.io`; building that pack therefore requires Namastex registry
credentials. An OSS user does not build the pack. They consume the prebuilt SPA
from the `@automagik/omni` package or the `omni-admin-ui` GHCR image. The
artifact contains compiled UI output, not a dependency on the private registry.

The current tree is still the pre-consolidation shape. `apps/khal-ui` is a
nested workspace and is excluded from the root workspace, so a root
`bun install` does **not** install or prove the UI source graph. Source builders
must install the nested workspace separately:

```bash
# Public/root graph; must never resolve @khal-os/*.
bun install

# Private source-build graph; needs registry credentials.
cd apps/khal-ui
bun install --frozen-lockfile
```

The exact `@khal-os/*` source-build pins are `@khal-os/sdk@2.0.111`,
`@khal-os/ui@2.0.111`, and `@khal-os/types@2.2.63`. Keep credentials in the
user-level npm configuration or CI secret mount; never commit an auth token.

When the nested workspace is dissolved, the boundary is intentionally this:

- `apps/ui/server` and a `@khal-os/*`-free `apps/ui/dev` join the root workspace.
- `apps/ui/app` remains outside the root workspace as the token-gated build
  island, with its own minimal lockfile and registry mapping.
- `apps/ui/package.json` is an umbrella only and has no `workspaces` field.
- The token-holding build job produces the SPA artifact. If the prospective
  `wish/omni-appkit-gap` SDK-dependent BFF lands, that job also bundles the BFF
  to a single consumer artifact; consumer installs never resolve its SDK.
- Artifact packaging preserves the published KHAL OS Elastic-2.0 notices and
  third-party notices, including Paper Design's PolyForm Shield 1.0.0 notice.

The existing `.github/workflows/image-publish.yml` exercises the private build
leg only when `KHAL_NPM_TOKEN` is present. The public boundary has this static
manual gate from the repository root:

```bash
bun -e 'const p=await Bun.file("package.json").json(); const forbidden=["apps/khal-ui","apps/ui/app","apps/ui/*","apps/*"]; if((p.workspaces??[]).some((x)=>forbidden.includes(x))) throw new Error("private UI app entered the root workspace")'
bun -e 'const lock=await Bun.file("bun.lock").text(); if(lock.includes("@khal-os/")||lock.includes("git.namastex.io/api/packages/khal/npm")) throw new Error("private UI dependency entered the root lock")'
```

After consolidation, Group 2 must also prove the meaningful boundary with a
fresh tokenless clone plus `bun install`; the current excluded-workspace pass is
not represented as that proof.

The BFF needs the Omni API key. **Never commit it** — `.env` is git-ignored.

```bash
cp apps/khal-ui/.env.example apps/khal-ui/.env
# then edit .env:
#   OMNI_API_KEY=omni_sk_…        (from ~/.omni/config.json → apiKey)
#   OMNI_BASE_URL=http://192.168.139.2:8882
```

The key is injected as `x-api-key` by the BFF only. It never reaches the browser
or the frontend bundle.

## Run

```bash
# Dev: BFF (127.0.0.1:8899) + Vite harness (localhost:5174) together
cd apps/khal-ui && bun run dev
# open http://localhost:5174  → renders MainView with a LIVE instance list

# Or run them separately:
bun run dev:bff        # BFF only
bun run dev:harness    # Vite harness only
```

## Data path

```
browser ──/omni/api/v2/*──▶ Vite proxy ──▶ BFF ──inject x-api-key──▶ Omni backend
                                            └─ strips /omni, forwards /api/v2/* only
```

The `@omni/sdk` client is created with `baseUrl = <bff>/omni`. The SDK appends
`/api/v2`, so `instances.list()` becomes `/omni/api/v2/instances`, which the BFF
forwards to `${OMNI_BASE_URL}/api/v2/instances`. Only `/api/v2/*` is reachable
through the BFF (allowlist). Bodies stream through unbuffered so SSE endpoints
(`/logs/stream`, `/agent-state/stream`) work.

Off-spec / dark families (trust, handoffs, follow-up, agent-state, turns,
context) are reached through the typed helpers in `package/src/api/ext.ts`.

## Quality gates

```bash
cd apps/khal-ui
bun run typecheck        # tsc across scripts/service/pack/harness
bun run build            # regenerate inventory + tsup build the pack
bun run test             # BFF + manifest tests
bun run capabilities         # regenerate capabilities.json
bun run capabilities:check   # verify capabilities.json is up to date (CI gate)
```

### Capability inventory

`scripts/build-capability-inventory.ts` merges three route-census sources —
`packages/api/src/constants/scopes.ts` (SCOPE_MAP), `packages/api/src/routes/v2/index.ts`
(mounted families), and the vendored OpenAPI snapshot (`scripts/openapi.snapshot.json`) — plus the known dark
families (trust, handoffs) into `package/src/capabilities/capabilities.json`.

Each capability carries `route`, `method`, `resource`, `scope`, `inOpenApi`,
`inScopeMap`, `mutating`, `destructive`, `realtime`, and a `uiStatus` coverage
level (`none → exposed → operable → live-verified → ux-complete`). `uiStatus` is
preserved across regenerations, so later groups raise coverage without breaking
`--check`.

```bash
bun scripts/build-capability-inventory.ts --check                 # drift gate (exit 1 on drift)
bun scripts/build-capability-inventory.ts --assert-exposed-all    # exit 1 if any capability < exposed
bun scripts/build-capability-inventory.ts --assert-operable <re>  # exit 1 if matching capability < operable
```

Current totals: **268 capabilities** (136 in-spec, 132 off-spec), 241 scope-mapped,
32 destructive, 2 realtime, 2 dark families (`trust`, `handoffs`).
