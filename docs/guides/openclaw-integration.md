# OpenClaw ↔ Omni Integration Report

> Written by Eva 👰 after first-time setup on 2026-02-23.
> This documents what happened, what broke, why, and what would make this seamless.

---

## What We Were Trying to Do

Connect a Telegram bot (via Omni) to an OpenClaw agent (Eva), so that messages sent to the bot are routed to the agent and responses are delivered back to Telegram.

The intended flow:
```
Telegram user → @GenieEvaBot → Omni → OpenClaw gateway → Eva agent → response → Telegram
```

---

## What Actually Happened (Step by Step)

### 1. Omni API was crash-looping (937 restarts)

**Root cause:** Two conflicting pgserve processes.

The PM2 ecosystem had `omni-v2-pgserve` as a separate managed process holding port 8432. A newer version of the API added embedded pgserve support — but `PGSERVE_EMBEDDED` was not set in the environment when PM2 started the API, so the API tried to start its own pgserve on the same port and failed with `"Failed to listen at 127.0.0.1"` (misleading error — the real issue was port 8432 already taken).

**Fix:** Remove the separate `omni-v2-pgserve` PM2 process. Add `PGSERVE_EMBEDDED=false` (or remove it entirely and let the new embedded take over). Redeploy the PM2 ecosystem with env loaded.

**What would prevent this:** The install guide (`install.md`) should document the embedded pgserve as the default and warn that `omni-v2-pgserve` as a separate PM2 process is deprecated.

---

### 2. API key was lost after redeploy

**Root cause:** Fresh install generated a new API key stored in a new pgserve database (`~/.omni/data/pgserve`). The CLI config (`~/.omni/config.json`) still had the old key. The key is stored as a bcrypt hash — there's no way to retrieve it after generation.

**Fix:** Delete the `__primary__` row from `api_keys` table, inject `OMNI_API_KEY=<known_key>` into the PM2 environment, restart — the API re-creates the primary key using the env value.

**What would prevent this:** 
- `omni install` should write the generated key to `~/.omni/config.json` automatically (it may already do this — unclear why it didn't here).
- `omni status` should show a clear warning when `keyValid: no` with a recovery command.
- Add `omni keys recover` or `omni auth reset` command that regenerates a fresh key and updates the CLI config in one step.

---

### 3. CLI was pointing to the wrong API URL

After the new install, the API was on port 8882 but `~/.omni/config.json` had `apiUrl: http://localhost:8899` from the installer's server-config. Simple fix (`omni config set apiUrl http://localhost:8882`) but confusing.

**What would prevent this:** The installer should always sync the CLI config URL with the actual bound port.

---

### 4. `omni providers create --config` doesn't exist

The existing skill docs said:
```bash
omni instances create --channel telegram --name "my-telegram" --config '{"botToken": "..."}'
```

This flag doesn't exist. The correct flag is `--telegram-token`.

**What would prevent this:** The deprecated `omni-cli` SKILL.md had wrong syntax. The newer plugin skills had correct syntax. **The skill content was outdated.** → This is the core motivation for the skill refactor we're planning.

---

### 5. Provider creation succeeds but `operator.write` scope fails

This was the hardest part and took the most time.

**Root cause (3 layers):**

**Layer 1 — Wrong provider ID persisted in client pool:**
After deleting and recreating the provider, the old provider ID (`8aed394c`) was still being used in reconnect loops because the `openclawClientPool` (keyed by provider ID) had the old client cached in memory. The pool is lazy — it creates clients on first trigger, not at API start — but once created it holds them even after the provider is deleted from the DB.

**Fix:** Restart the API after deleting a provider.

---

**Layer 2 — Gateway token alone is not enough for `operator.write`:**
When Omni connects to the OpenClaw gateway with just the shared token (`gateway.auth.token`), the gateway **strips all declared scopes** for shared-token connections. Omni was declaring `["operator.read", "operator.write"]` but the gateway silently removed them, so `chat.send` failed with `"missing scope: operator.write"`.

This is documented in Omni's source (`agent-dispatcher.ts`):
```
// Without device credentials, the gateway strips all declared scopes for shared-token
// connections, causing chat.send to fail with "missing scope: operator.write".
```

The fix requires a **device identity** — an Ed25519 keypair registered with the gateway.

---

**Layer 3 — No CLI/UI flow exists to set up the device identity:**

There is no `omni providers setup` command. There is no UI wizard. The device identity must be:
1. Generated (Ed25519 keypair)
2. Registered in the gateway's `~/.openclaw/devices/paired.json`
3. Stored in the provider's `schemaConfig` via a PATCH to the API

None of this is documented anywhere. The schema fields (`deviceId`, `devicePublicKey`, `devicePrivateKey`, `deviceToken`) are only discoverable by reading the Omni source code.

**What we did:**
```bash
# 1. Generate keypair via bun
bun -e "const crypto = await import('crypto'); ..."

# 2. Manually write to ~/.openclaw/devices/paired.json

# 3. PATCH the provider via curl
curl -X PATCH http://localhost:8882/api/v2/providers/<id> \
  -d '{"schemaConfig": {"deviceId": "...", "devicePublicKey": "...", ...}}'
```

---

## Full Working Setup (What the End State Looks Like)

```
PM2 processes:
  omni-v2-nats   ✓ online
  omni-v2-api    ✓ online (embedded pgserve, no separate pgserve process)

CLI:
  omni status → apiStatus: healthy, keyValid: yes

Provider (openclaw schema):
  baseUrl: ws://127.0.0.1:18789
  apiKey: <gateway shared token>
  schemaConfig:
    defaultAgentId: eva
    deviceId: <sha256 hex of ed25519 pubkey>
    devicePublicKey: <base64url>
    devicePrivateKey: <base64url>
    deviceToken: <gateway-issued token>

Instance:
  channel: telegram
  agentProviderId: <provider id>
  agentId: eva
  isDefault: true
```

---

## What Would Make This Seamless

### Priority 1 — `omni providers setup openclaw` command

A single command that:
1. Prompts for (or accepts as flags): gateway URL, gateway token, agent ID
2. Generates Ed25519 keypair internally
3. Registers the device in the OpenClaw gateway (via API call or by writing `~/.openclaw/devices/paired.json`)
4. Creates the provider with all required `schemaConfig` fields populated
5. Tests connectivity and reports success

```bash
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token f327acb... \
  --agent-id eva
```

Expected output:
```
✓ Generated device keypair
✓ Registered device with gateway (operator.read + operator.write)
✓ Created provider: eva-openclaw
✓ Provider is healthy (latency: 18ms)

Next: assign to instance with --agent-provider <id>
```

---

### Priority 2 — PM2 ecosystem clarity

The `omni-v2-pgserve` separate process was a footgun. The embedded pgserve is strictly better (no port conflicts, single process to manage). The ecosystem should:
- Not include `omni-v2-pgserve` at all if `PGSERVE_EMBEDDED` is the default
- Or explicitly document in the ecosystem file which process is deprecated

---

### Priority 3 — `omni auth recover` command

When `keyValid: no`, users are stuck. Add:
```bash
omni auth recover
# Checks which key the server is using, updates ~/.omni/config.json
# Or: generates a new primary key and updates both server + CLI
```

---

### Priority 4 — Install guide update

The current `install.md` is good but missing:
- The openclaw provider setup flow (Priority 1 above)
- Warning about `omni-v2-pgserve` being deprecated
- Troubleshooting for `keyValid: no` after redeploy

---

### Priority 5 — Skill content validation

The existing `omni-cli` SKILL.md had wrong `--config` flag syntax for `instances create`. 

The planned skill refactor (unifying `.agents/skills/` + `plugins/omni/skills/` under `plugins/omni/skills/`) should include **live validation** — every code example in a skill should be checked against the actual CLI help output before publishing.

---

## Timing

| Step | Time spent |
|------|-----------|
| Diagnosing crash-loop | ~15 min |
| Fixing pgserve conflict + key recovery | ~20 min |
| Creating provider + Telegram instance | ~5 min |
| Debugging `operator.write` scope error | ~25 min |
| **Total** | **~65 min** |

Target with seamless tooling: **< 5 min** (gateway URL + token + agent ID → working bot).

---

## Key Insight

The `operator.write` scope issue is non-obvious and completely undocumented. Anyone trying to connect Omni to OpenClaw will hit this. The device pairing requirement exists for security (shared tokens can't get write access), but the **path to fix it must be built into the CLI** — not left as a source-code archaeology exercise.

The `omni providers setup openclaw` command is the single highest-leverage improvement.
