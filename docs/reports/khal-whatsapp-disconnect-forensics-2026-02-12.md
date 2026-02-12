# Forensic Report — khal-whatsapp disconnect (2026-02-12)

- **Instance ID:** `0567bded-23f6-439f-b49f-773fa7f47419`
- **Instance name:** `khal-whatsapp`
- **Owner JID:** `551151986804:1@s.whatsapp.net`
- **Service:** `omni-v2-api` (PM2)
- **Investigation time:** 2026-02-12 (BRT)
- **Data sources:**
  - Full PM2 stdout copy: `docs/reports/tmp/omni-v2-api-out.log` (~33k lines)
  - Full PM2 stderr copy: `docs/reports/tmp/omni-v2-api-error.log` (550 lines)
  - Targeted grep/parse over instance ID, owner JID, disconnect/ban keywords

---

## Executive conclusion (ASAP answer)

**This incident is consistent with _device removal / session conflict logout_, not a WhatsApp temporary ban.**

### Why

At the exact disconnect moment, logs show a canonical WA protocol conflict payload:

- `stream:error` with `code:"401"`
- nested `conflict` node with `type:"device_removed"`
- immediate transition to logged-out state with no reconnect

Evidence (same timestamp window):

- `out.log:22992`:
  - `"fullErrorNode":{"tag":"stream:error","attrs":{"code":"401"},"content":[{"tag":"conflict","attrs":{"type":"device_removed"}}]}`
- `out.log:22993`:
  - `"statusCode":401,"reason":"Stream Errored (conflict)","wasLoggedOut":true`
- `out.log:22994`:
  - `"Instance disconnected" ... "reason":"Logged out from WhatsApp","willReconnect":false`
- `out.log:22995`:
  - `"Marked inactive (logged out)"`
- `out.log:22996`:
  - `"Disconnected" ... "willReconnect":false,"reason":"Logged out from WhatsApp"`

No ban indicators were found for this instance in raw logs:

- no `403/405` as WA disconnect status codes for this instance
- no `temporarily banned`, `temp ban`, `spam`, `abuse`, `rate limit` tied to this instance

---

## Timeline (UTC and BRT)

> BRT = UTC-3

### Pre-incident behavior (unstable but recoverable)

From 2026-02-10 through 2026-02-12 15:21 UTC, the instance had intermittent drops and reconnects (mostly `Unknown error`, plus occasional `408`, `428`, `503`, `515`) with `wasLoggedOut:false`.

Representative events:

- **2026-02-10 22:51:59 UTC** / **19:51:59 BRT**
  - `Connection closed` status `515` (`restart required`), `wasLoggedOut:false` (`out.log:6014`)
- **2026-02-11 07:09:07 UTC** / **04:09:07 BRT**
  - `Connection was lost` status `408`, `wasLoggedOut:false` (`out.log:8658`)
- **2026-02-11 17:58:42 UTC** / **14:58:42 BRT**
  - `Connection Terminated` status `428`, `wasLoggedOut:false` (`out.log:16135`)
- **2026-02-11 21:21:39 UTC** / **18:21:39 BRT**
  - `Stream Errored (unknown)` status `503`, `wasLoggedOut:false` (`out.log:18299`)

Parsed count for `whatsapp:connection` → `Connection closed` (target instance):
- 130 total
- 118x `Unknown error` (`wasLoggedOut:false`)
- 4x `408`
- 4x `428`
- 2x `503`
- 1x `515`
- **1x `401 conflict` with `wasLoggedOut:true` (the incident)**

### Incident anchor (logout event)

- **2026-02-12 15:21:52 UTC** / **12:21:52 BRT**
  - WA low-level error includes `device_removed` conflict (`out.log:22992`)
  - Connection closed as `401 Stream Errored (conflict)` with `wasLoggedOut:true` (`out.log:22993`)
  - Instance disconnected as `Logged out from WhatsApp`, `willReconnect:false` (`out.log:22994`)
  - Instance marked inactive/logged out (`out.log:22995`)

### Immediate post-incident effects

Seconds after logout, send attempts begin failing because socket is gone:

- **2026-02-12 15:22:00 UTC** / **12:22:00 BRT**
  - `api:error`: `Instance ... not connected` (`error.log:518`)
- Repeated same error for subsequent send attempts (`error.log:519..525`, `530..536`, etc.)
- Corresponding HTTP `POST /api/v2/messages/send` become `500` right after disconnect (`out.log:22997+`)

### Recovery attempts

After logout, API serves QR/status endpoints and QR lifecycle events (generated/expired), indicating re-pair workflow rather than auto-reconnect of prior session:

- multiple `GET /status` + `GET /qr` 200 responses
- `QR code generated` / `QR code expired`
- `Created new credentials` events

This is consistent with session replacement/re-auth requirement after device removal.

---

## Temp-ban hypothesis check

### Checked indicators (instance-scoped)

Searched both full stdout/stderr for the target instance + owner JID across:

- `403`, `405`
- `temporarily banned`, `temp ban`
- `spam`, `abuse`
- `rate limit`, `ratelimit`, `too many requests`
- explicit WA stream errors tied to ban semantics

### Result

- **No positive evidence** of temp ban for this instance.
- The one decisive protocol-level event is **`401 + conflict/device_removed`**, which points to logout caused by session conflict/device removal.

> Note: naive keyword counts of `403/405` over all target lines produced false positives due to UUIDs/request IDs containing those digits. When constrained to WA status fields and explicit ban semantics, there is no ban evidence.

---

## Message volume / sequence around failure

- Last successful send before failure window:
  - `POST /api/v2/messages/send` returned `201` at `1770909710553` (`out.log:22991`)
- ~2.2 seconds later, `device_removed` + `401 conflict` logout fires (`out.log:22992..22996`)
- Then repeated `POST /messages/send` failures (`500`) and `Instance not connected` errors begin immediately (`out.log:22997+`, `error.log:518+`)

This sequencing strongly supports **session invalidation happening first**, with send failures as downstream effect.

---

## Final determination

**Root-cause classification:**
- **Primary:** WhatsApp session conflict resulting in **device removed** logout.
- **Not supported by evidence:** temporary ban.

**Confidence:** High (direct protocol payload evidence).

---

## Recommended next actions

1. **Treat as re-link/session ownership event**
   - Confirm whether someone re-linked/removed this companion device in WhatsApp at ~12:21:52 BRT.
2. **Re-pair cleanly and validate exclusivity**
   - Complete QR pairing and ensure no competing automation/session is attaching to same account.
3. **Add explicit telemetry guardrail**
   - Emit structured alert when `stream:error code=401` + `conflict type=device_removed` occurs.
4. **Harden incident dashboards**
   - Separate ban signals from generic numeric keyword matches (avoid false positives from IDs/UUIDs).
5. **Optional hygiene follow-up**
   - Investigate recurring unrelated DB uuid parsing noise (`120363424660366845@g.us`) to reduce background log noise during future forensics.
