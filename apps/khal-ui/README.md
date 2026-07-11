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
# From the repo root (bun-only):
bun install

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
