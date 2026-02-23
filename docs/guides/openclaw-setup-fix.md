# Bug Report: `omni providers setup openclaw` — Fix Instructions

> Diagnosed by Eva 👰 on 2026-02-23.
> The command exists and the flow is mostly right — two bugs need patching.

---

## Current Behavior

```
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token <token> \
  --agent-id eva
```

**Fails at step 2 with one of two errors:**

1. `invalid connect params: at /client/id: must be equal to constant` ← Bug A
2. `missing scope: operator.pairing` ← Bug B (different root cause than it appears)

---

## Bug A — Wrong `client.id` in connect handshake

### Location
`packages/cli/src/commands/providers-setup.ts`, function `connectWithToken`, line ~212:

```ts
client: {
  id: 'omni-cli-setup',  // ← WRONG
  ...
}
```

### Fix
```ts
client: {
  id: 'gateway-client',  // ← CORRECT (gateway enforces this as a constant)
  ...
}
```

**Already fixed in this branch.** ✓

---

## Bug B — Wrong pairing strategy

### What the current code does

After connecting, the setup command makes two explicit RPC calls:
1. `node.pair.request` — request pairing
2. `node.pair.approve` — approve it (requires `operator.pairing` scope)

The shared gateway token (`gateway.auth.token`) does **not** have `operator.pairing` scope for shared-token connections. So step 2 fails with `missing scope: operator.pairing`.

### Why this approach is wrong

The gateway has a **silent auto-approve** path built into the **connect handshake itself**.

When a device connects:
- If the connecting client is **local** (`remoteIp` is loopback), the gateway sets `silent: true` on the pairing request
- A `silent` pairing request is **auto-approved immediately**, no `operator.pairing` scope needed
- The resulting device token is returned directly in the **`hello-ok` response** under `auth.deviceToken`

Source: `gateway-cli-BYMlAFfC.js` line ~19137:
```js
silent: isLocalClient   // ← auto-approves if connecting from localhost
```

And line ~19265:
```js
auth: deviceToken ? {
  deviceToken: deviceToken.token,
  role: deviceToken.role,
  scopes: deviceToken.scopes,
  issuedAtMs: deviceToken.rotatedAtMs ?? deviceToken.createdAtMs
} : void 0,
```

### The correct flow

```
1. Generate Ed25519 keypair  (already done correctly)

2. Open WebSocket to gateway

3. Send connect frame with:
   - auth.token = gateway shared token          (for initial WS auth)
   - device = { id, publicKey, signature, ... } (triggers device pairing path)
   - role = 'operator'
   - scopes = ['operator.read', 'operator.write']
   - client.id = 'gateway-client'               (Bug A fix)
   - client.mode = 'backend'
   - client.platform = 'omni'

4. Receive hello-ok response
   → payload.auth.deviceToken  ← this IS the device token, issued immediately
                                  because isLocalClient=true → silent auto-approve

5. Store deviceToken + keypair in provider schemaConfig

NO node.pair.request needed.
NO node.pair.approve needed.
NO operator.pairing scope needed.
```

### Fix

Replace the `pairDevice` function's body. Instead of the `node.pair.request` + `node.pair.approve` RPC dance, just:

1. Send the connect frame **with device credentials** (signed Ed25519)
2. Read `hello-ok` → `payload.auth.deviceToken`
3. Return that as the device token

The device signing logic already exists in `packages/core/src/providers/openclaw/client.ts` — copy the signature construction from there.

**Key signing logic** (from `client.ts` lines ~395-415):
```ts
const payload = [
  'v2',
  dev.id,
  clientId,        // 'gateway-client'
  clientMode,      // 'backend'
  role,            // 'operator'
  scopes.join(','), // 'operator.read,operator.write'
  String(signedAtMs),
  dev.token,       // empty string '' for first connect (no token yet)
  nonce,           // from connect.challenge event (or random if no challenge)
].join('|');

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const rawPrivKey = Buffer.from(dev.privateKey, 'base64url');
const pkcs8Der = Buffer.concat([PKCS8_PREFIX, rawPrivKey]);
const privateKey = nodeCrypto.createPrivateKey({ key: pkcs8Der, type: 'pkcs8', format: 'der' });
const signature = nodeCrypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
```

For first-time pairing (no existing device token), use `''` (empty string) as `dev.token` in the payload.

The connect frame device field:
```ts
device: {
  id: keypair.deviceId,
  publicKey: keypair.publicKey,
  signature,
  signedAt: signedAtMs,
  nonce,
}
```

And use the gateway shared token in `auth.token` (not the device token — that comes back in the response).

---

## Summary of changes needed

| File | Change |
|------|--------|
| `providers-setup.ts` | `client.id: 'gateway-client'` (already done) |
| `providers-setup.ts` | Replace `pairDevice()` — use device connect flow, not `node.pair.request/approve` |
| `providers-setup.ts` | Remove `--pairing-token` flag (not needed with correct flow) |
| `providers-setup.ts` | Read device token from `hello-ok` response `auth.deviceToken` |

---

## Reference Implementation

The complete working signing + connect logic is in:
`packages/core/src/providers/openclaw/client.ts` — `sendConnectHandshake()` method

The setup command should reuse `generateDeviceKeypair()` (already does) and mirror the handshake logic from that file, with `dev.token = ''` for the first-time connect (since there's no existing token yet).

---

## Expected output after fix

```
$ omni providers setup openclaw \
    --gateway-url ws://127.0.0.1:18789 \
    --gateway-token f327acb... \
    --agent-id eva

✔ Device keypair generated (deviceId: f88184103e33...)
✔ Device paired with gateway (operator.read + operator.write)
✔ Provider created: eva-openclaw
✔ Provider is healthy (latency: 18ms)

Provider ID: f096eb2e-...
Next: assign to instance
  omni instances update <id> --agent-provider f096eb2e-... --agent eva
```
