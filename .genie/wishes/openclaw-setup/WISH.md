# Wish: OpenClaw Integration UX Overhaul

**Status:** IN_PROGRESS
**Slug:** `openclaw-setup`
**Created:** 2026-02-23

---

## Summary

First-time OpenClaw setup takes 65 minutes of source-code archaeology (Ed25519 keypair generation, manual gateway device registration, undocumented schemaConfig PATCH). This wish adds `omni providers setup openclaw` (single command, < 30s), `omni auth recover` (key recovery), and updates the install guide. Target: any AI agent can go from zero to working OpenClaw integration in < 5 minutes.

---

## Scope

### IN
- `omni providers setup openclaw` — interactive wizard: keypair gen → WS device pairing → provider creation
- `omni auth recover` — API key recovery when `keyValid: no`
- Install guide update — OpenClaw section, pgserve deprecation note, keyValid troubleshooting
- OpenAPI schema docs — document device pairing fields in provider schemaConfig

### OUT
- OpenClaw gateway-side changes (we control Omni CLI/API only)
- Provider schema redesign (schemaConfig stays jsonb)
- Client pool stale-entry bug (filed separately, workaround = restart)
- Skill content validation automation (deferred to separate task)

---

## Decisions

- **DEC-1: Device registration via WS RPC.** The CLI connects to gateway WS, calls `node.pair.request`, then `node.pair.approve` (requires `operator.pairing` scope on shared token). Fallback: print request ID for manual approval via `openclaw devices approve`. No filesystem access to gateway needed — works remotely.
- **DEC-2: Ed25519 keypair via node:crypto.** Same primitives already proven in `packages/core/src/providers/openclaw/client.ts`. Generate at setup time, store in provider `schemaConfig`.
- **DEC-3: Auth recover via key delete + PM2 env injection.** Generate new key → delete existing `__primary__` key from DB (via API or direct call) → set `OMNI_API_KEY` in PM2 env → restart API (which seeds the key when no primary exists) → update `~/.omni/config.json`. Safe because requires local machine access.

---

## Success Criteria

- [ ] `omni providers setup openclaw --gateway-url ws://... --gateway-token ... --agent-id eva` creates a working provider in < 30s
- [ ] `omni providers test <id>` passes after setup (connectivity + scopes)
- [ ] `omni auth recover` restores `keyValid: yes` from a `keyValid: no` state
- [ ] `docs/guides/install.md` has OpenClaw section with working CLI examples
- [ ] `make typecheck && make lint` pass after all changes

---

## Assumptions

- **ASM-1:** The gateway shared token used during setup has `operator.pairing` scope (or user can manually approve)
- **ASM-2:** `OMNI_API_KEY` env var on API startup seeds the primary key ONLY when no primary key exists in DB. Recovery flow must first delete the existing `__primary__` key record before the restart-with-env-var path takes effect.
- **ASM-3:** The OpenClaw WS RPC protocol (`node.pair.request`, `node.pair.approve`) is stable

## Risks

- **RISK-1:** Gateway token lacks `operator.pairing` scope → auto-approve fails — Mitigation: detect + fallback to manual approval flow with clear instructions
- **RISK-2:** Auth recover only works locally (PM2 access required) — Mitigation: document limitation, point to `omni keys create` + `omni auth login` for remote
- **RISK-3:** Device token rotation on re-pair invalidates stored credentials — Mitigation: document that re-pairing requires re-running setup

---

## Execution Groups

### Group A: `omni providers setup openclaw` command

**Goal:** Single command that takes gateway URL + token + agent ID and produces a fully working OpenClaw provider with device identity.

**Deliverables:**
- New `setup` subcommand in `packages/cli/src/commands/providers.ts` (or separate `providers-setup.ts`)
- Ed25519 keypair generation helper (reuse crypto from `packages/core/src/providers/openclaw/client.ts`)
- WS RPC client for `node.pair.request` + `node.pair.approve` (lightweight, setup-only — not the full `OpenClawClient`)
- Provider creation via Omni API with populated `schemaConfig` (deviceId, devicePublicKey, devicePrivateKey, deviceToken, defaultAgentId)
- Automatic `omni providers test <id>` at end of setup

**Acceptance Criteria:**
- [ ] `omni providers setup openclaw --gateway-url ws://127.0.0.1:18789 --gateway-token <token> --agent-id eva` completes successfully
- [ ] Provider is created with all 4 device fields in schemaConfig
- [ ] `omni providers test <id>` returns healthy
- [ ] If token lacks `operator.pairing`, prints manual approval instructions and waits/retries
- [ ] Interactive mode prompts for missing flags; `--non-interactive` errors on missing required flags

**Validation:**
```bash
omni providers setup openclaw --gateway-url ws://127.0.0.1:18789 --gateway-token $(cat ~/.openclaw/.env | grep GATEWAY_AUTH_TOKEN | cut -d= -f2) --agent-id eva
omni providers test $(omni providers list --json | jq -r '.[-1].id')
```

---

### Group B: `omni auth recover` command

**Goal:** One command to fix `keyValid: no` — generates new key, updates PM2 env + API + CLI config.

**Deliverables:**
- New `recover` subcommand in `packages/cli/src/commands/auth.ts`
- Extract `generateApiKey()` from `install.ts` to shared util (e.g. `packages/cli/src/utils/keys.ts`)
- Delete existing `__primary__` key from DB before seeding (via `omni keys delete` API call or direct endpoint)
- PM2 env update via `pm2 restart omni-v2-api --update-env` (lookup by name, not ID)
- API restart
- CLI config update (`~/.omni/config.json`)

**Acceptance Criteria:**
- [ ] Starting from `omni status` showing `keyValid: no`
- [ ] `omni auth recover` generates new key, restarts API, updates CLI config
- [ ] `omni status` shows `keyValid: yes` after recovery
- [ ] Command fails gracefully if PM2 is not available (prints manual instructions)
- [ ] Command fails gracefully if API is not running locally

**Validation:**
```bash
# Simulate broken state:
omni config set apiKey omni_sk_0000000000000000000000000000dead
omni status | grep keyValid  # → no

# Recover:
omni auth recover
omni status | grep keyValid  # → yes
```

---

### Group C: Install guide + OpenAPI docs update

**Goal:** AI agents can follow `docs/guides/install.md` end-to-end including OpenClaw provider setup.

**Deliverables:**
- New "OpenClaw Provider Setup" section in `docs/guides/install.md`
- Troubleshooting entries for: `keyValid: no` recovery, pgserve port conflict, stale provider pool
- OpenAPI schema description update for openclaw `schemaConfig` fields (document deviceId, devicePublicKey, devicePrivateKey, deviceToken)

**Acceptance Criteria:**
- [ ] `docs/guides/install.md` includes OpenClaw section with `omni providers setup openclaw` example
- [ ] All CLI examples in the guide match actual `omni <cmd> --help` output
- [ ] OpenAPI schema at `packages/api/src/schemas/openapi/providers.ts` documents device fields

**Validation:**
```bash
grep -q "providers setup openclaw" docs/guides/install.md
grep -q "deviceId" packages/api/src/schemas/openapi/providers.ts
```

---

### Group D: Device pairing crypto helpers (shared)

**Goal:** Extract reusable Ed25519 keypair generation + deviceId derivation so both the CLI setup command and the existing OpenClaw client can share the same code.

**Deliverables:**
- `packages/core/src/providers/openclaw/device.ts` — exports `generateDeviceKeypair()` returning `{ deviceId, publicKey, privateKey }` in the formats the gateway expects (SHA256 hex ID, base64url keys)
- Update `packages/core/src/providers/openclaw/client.ts` to import from `device.ts` instead of inline crypto

**Acceptance Criteria:**
- [ ] `generateDeviceKeypair()` returns keys in correct format (base64url, 32-byte raw Ed25519)
- [ ] `deviceId` is SHA256 hex of raw public key bytes
- [ ] Existing `OpenClawClient` signing still works after refactor
- [ ] `make typecheck` passes

**Validation:**
```bash
bun -e "import { generateDeviceKeypair } from './packages/core/src/providers/openclaw/device.ts'; const kp = generateDeviceKeypair(); console.log(kp)"
make typecheck
```

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
# Group A — Setup command
packages/cli/src/commands/providers.ts        # Add setup subcommand (or new file)

# Group B — Auth recover
packages/cli/src/commands/auth.ts             # Add recover subcommand

# Group C — Docs
docs/guides/install.md                        # Add OpenClaw section
packages/api/src/schemas/openapi/providers.ts # Document device schemaConfig fields

# Group D — Shared crypto
packages/core/src/providers/openclaw/device.ts  # NEW: keypair generation
packages/core/src/providers/openclaw/client.ts  # Refactor to use device.ts
packages/core/src/providers/openclaw/index.ts   # Re-export
```
