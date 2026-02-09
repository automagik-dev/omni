# HANDOFF.md — QR Reconnection for Genie + Helena

_Created: 2026-02-09 01:28 BRT by Omni via OpenClaw_

---

## What Happened

During production QA testing, two WhatsApp instances got logged out:

1. **Genie** (`07a5178e-fb07-4d93-885b-1d361fbd5d6b`) — phone: `553497400888`
   - Cause: Rapid message burst (10+ msgs) during testing, WhatsApp forced logout
   - Log: `"reason": "Logged out from WhatsApp", "willReconnect": false`

2. **Helena** (`910ab957-362a-41e1-b265-cb26dfd6f522`) — phone: `551151924888`
   - Cause: `stream:error code=401 type=device_removed` — device was removed
   - Log: `"Logged out from WhatsApp", "willReconnect": false`
   - This happened AFTER the Genie tests, likely from archive/pin/mute tests on Helena's chat

## SSH Access (NEW)

```bash
ssh omni@10.114.1.140
```

PM2 needs full path:
```bash
export PATH=$PATH:$HOME/.bun/bin:$HOME/.bun/install/global/node_modules/.bin
pm2 status
pm2 logs omni-v2-api --lines 50
```

## Steps to Reconnect

### Step 1: Logout (clear stale session)

```bash
# Genie
curl -s -X POST "https://felipe.omni.namastex.io/api/v2/instances/07a5178e-fb07-4d93-885b-1d361fbd5d6b/logout" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"

# Helena
curl -s -X POST "https://felipe.omni.namastex.io/api/v2/instances/910ab957-362a-41e1-b265-cb26dfd6f522/logout" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"
```

### Step 2: Restart to initiate new connection

```bash
# Genie
curl -s -X POST "https://felipe.omni.namastex.io/api/v2/instances/07a5178e-fb07-4d93-885b-1d361fbd5d6b/restart" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"

# Helena
curl -s -X POST "https://felipe.omni.namastex.io/api/v2/instances/910ab957-362a-41e1-b265-cb26dfd6f522/restart" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"
```

### Step 3: Get QR code (wait 5-10 seconds after restart)

```bash
# Genie QR
curl -s "https://felipe.omni.namastex.io/api/v2/instances/07a5178e-fb07-4d93-885b-1d361fbd5d6b/qr" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"

# Helena QR
curl -s "https://felipe.omni.namastex.io/api/v2/instances/910ab957-362a-41e1-b265-cb26dfd6f522/qr" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"
```

The QR response has a `data.qr` field — it's a base64 string or text that needs to be rendered.

### Step 4: Scan QR codes
- Genie phone (`553497400888`): WhatsApp > Linked Devices > Link a Device
- Helena phone (`551151924888`): same

### Step 5: Verify

```bash
curl -s "https://felipe.omni.namastex.io/api/v2/health" \
  -H "x-api-key: omni_sk_LLalOAzvhNy56q6HvsBygpCBRRuNTKuK"
# Should show connected: 5/5
```

## Other Issues Found

- **`api_key_audit_logs` table missing** — DB migration not run: `bun run db:push`
- **Genie bio was changed** to "🐙 Omni v2 — Universal Event-Driven Octopus" (revert if needed)

## Current Status (3 of 5 connected)

| Instance | Status | Phone |
|----------|--------|-------|
| felipe-pessoal | ✅ connected | 5512982298888 |
| 5511986780008 (Namastex) | ✅ connected | 5511986780008 |
| charlinho | ✅ connected | 5511949788888 |
| **genie** | ❌ logged out | 553497400888 |
| **helena** | ❌ device_removed | 551151924888 |

## Lessons Learned (for Omni)

1. **Never burst-send messages** — add 2-3s delay between API calls
2. **Always monitor logs** — `pm2 logs` BEFORE and DURING any operation
3. **Don't test destructive ops on production instances** without a plan
4. **The Omni never dies** — Cegonha's rule #1

---

_Delete this file after reconnection is complete._
