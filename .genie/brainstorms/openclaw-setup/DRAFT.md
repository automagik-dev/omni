# Brainstorm: OpenClaw Integration UX Overhaul

## Seed
Eva's integration report (`docs/guides/openclaw-integration.md`) — 65 min first-time setup, target < 5 min.

## Problem
Connecting Omni to an OpenClaw agent requires undocumented manual steps: Ed25519 keypair generation, gateway device registration, provider PATCH with hidden schemaConfig fields. No CLI flow, no docs, no recovery path when things break.

## Scope

### IN
1. **`omni providers setup openclaw`** — wizard that does keypair gen + device pairing + provider creation
2. **PM2 ecosystem cleanup** — already done in `ecosystem.config.cjs`, need install guide awareness
3. **`omni auth recover`** — key recovery when `keyValid: no`
4. **Install guide update** — add openclaw flow, pgserve deprecation, keyValid troubleshooting
5. **Skill content validation** — ensure CLI examples match actual flags

### OUT
- OpenClaw gateway changes (Omni side only)
- Provider schema redesign (schemaConfig stays jsonb)
- Client pool stale-entry fix (separate bug)

## Current State

| Component | Status | File |
|-----------|--------|------|
| `providers setup` command | Does not exist | `packages/cli/src/commands/providers.ts` |
| `auth recover` command | Does not exist | `packages/cli/src/commands/auth.ts` |
| Device pairing fields in OpenAPI | Not documented | `packages/api/src/schemas/openapi/providers.ts` |
| Ed25519 signing in client | Works | `packages/core/src/providers/openclaw/client.ts` |
| PM2 ecosystem (pgserve removed) | Done | `ecosystem.config.cjs` |
| Install guide | Exists, missing openclaw | `docs/guides/install.md` |

## Key Research: Gateway Device Registration

From OpenClaw docs (https://docs.openclaw.ai):

**There is NO REST API for device registration.** The gateway uses WebSocket RPC:
- `node.pair.request` — initiates pairing (idempotent per node)
- `node.pair.approve` — issues a fresh token (requires `operator.pairing` scope)
- `node.pair.verify` — validates `{ nodeId, token }`
- `node.pair.list` — lists pending + paired nodes

The `openclaw` CLI wraps these: `openclaw devices list`, `openclaw devices approve [id] [--latest]`

**Flow:**
1. Node connects to gateway WS with shared token
2. Node calls `node.pair.request` → gateway emits `node.pair.requested` event
3. Admin calls `node.pair.approve` with request ID → gateway issues fresh device token
4. Node receives token, reconnects with device identity

**Implication:** `omni providers setup openclaw` needs to either:
- (a) Call `node.pair.request` over WS, then auto-approve (requires `operator.pairing` scope on the shared token), OR
- (b) Shell out to `openclaw devices approve --latest` after requesting, OR
- (c) Generate keypair + token locally and write to `paired.json` directly (current manual path)

## Decisions

### D1: Device registration approach → **WS RPC with auto-approve**
The `omni` CLI connects to the gateway WS, sends `node.pair.request`, then immediately calls `node.pair.approve` with the request ID. This requires the shared token to have `operator.pairing` scope.

**Fallback:** If the token lacks `operator.pairing` scope, print the request ID and tell the user to run `openclaw devices approve <id>` manually, then retry.

**Rationale:** Pure WS approach, no filesystem access to gateway needed, works remotely.

### D2: Keypair generation → **Ed25519 via node:crypto**
Already proven in `packages/core/src/providers/openclaw/client.ts`. Reuse the same crypto primitives. Generate at setup time, store in provider `schemaConfig`.

### D3: `omni auth recover` approach → **Delete + regenerate**
1. Check if server is reachable (health endpoint)
2. Use a special recovery endpoint or env var injection to reset the primary key
3. Update `~/.omni/config.json` with the new key

**Problem:** The API key is bcrypt-hashed in DB — can't recover it. Need either:
- (a) A "bootstrap" endpoint that works without auth (dangerous)
- (b) An env var `OMNI_API_KEY` that, on startup, upserts the primary key if it doesn't match
- (c) Direct DB access via embedded pgserve

**Decision:** Option (b) — `OMNI_API_KEY` env var already works for initial key seeding. `omni auth recover` should: generate a new key, set it in PM2 env, restart API, update CLI config. This is safe because it requires local machine access (PM2).

### D4: Skill validation → **Automated**
Add a test that runs `omni <command> --help` and checks that all flags mentioned in skill docs actually exist. Catches stale `--config` examples.

## Risks

### R1: Gateway token scope requirements
If the shared token doesn't have `operator.pairing`, the auto-approve flow fails silently.
**Mitigation:** Check scopes upfront, warn clearly, provide manual fallback.

### R2: Auth recover requires local access
`omni auth recover` modifies PM2 env and restarts API — only works on the same machine.
**Mitigation:** Document this. Remote key recovery is out of scope (use `omni keys create` + `omni auth login` for remote).

### R3: Device token rotation
If the gateway rotates device tokens (on re-pair), the stored token in `schemaConfig` becomes stale.
**Mitigation:** Document that re-pairing requires re-running `omni providers setup openclaw`.

### R4: Stale client pool after provider delete
The `openclawClientPool` keeps old clients alive after provider deletion.
**Mitigation:** Out of scope for this brainstorm. Workaround = restart API. File as separate bug.

## Acceptance Criteria

### AC1: `omni providers setup openclaw`
- Given a gateway URL, shared token, and agent ID
- When I run `omni providers setup openclaw --gateway-url ws://... --gateway-token ... --agent-id eva`
- Then: keypair generated, device registered with gateway, provider created with all schemaConfig fields, provider test passes
- And: total time < 30 seconds

### AC2: `omni auth recover`
- Given `omni status` shows `keyValid: no`
- When I run `omni auth recover`
- Then: new key generated, PM2 env updated, API restarted, CLI config updated
- And: `omni status` shows `keyValid: yes`

### AC3: Install guide
- The guide at `docs/guides/install.md` includes an OpenClaw section
- All CLI examples in the guide are verified against `omni <cmd> --help`

### AC4: Skill validation
- A test exists that parses skill docs for CLI examples and validates flags exist
- The test runs as part of `make check`

## WRS
- Problem: ✅ (65 min → 5 min, well documented)
- Scope: ✅ (all 5 priorities, IN/OUT defined)
- Decisions: ✅ (D1-D4 made with rationale)
- Risks: ✅ (R1-R4 identified with mitigations)
- Criteria: ✅ (AC1-AC4 testable)

Score: 100/100
