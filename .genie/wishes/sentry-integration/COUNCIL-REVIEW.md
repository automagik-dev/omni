# Council Review: Sentry Integration PR Comments

Reviewer: council-reviewer (Opus 4.6)
Date: 2026-03-10
Branch: `feat/sentry-integration`

---

## Comment 1: Hardcoded DSN

**Source:** Gemini (security-medium)
**Verdict: INVALID / NOISE**
**Severity: NOISE**

### Reasoning

The DSN is intentionally hardcoded as an OSS telemetry pattern. The code at `packages/api/src/instrument.ts:14-15` shows:

```typescript
const OMNI_SENTRY_DSN = 'https://2b2ca6f...@o4509714066571264.ingest.us.sentry.io/4510982636371968';
const dsn = process.env.SENTRY_DSN ?? OMNI_SENTRY_DSN;
```

- A Sentry DSN is a **write-only** ingest key. Knowing it only lets an attacker send garbage events, not read project data.
- This is the same pattern used by VS Code, Electron, Next.js, and many other OSS projects for opt-out telemetry.
- Users can set `SENTRY_DSN=""` to fully disable.
- The "DoS by exhausting quota" risk is mitigated by Sentry's own rate limiting and spike protection, which is a Sentry project setting, not a code concern.

**Action: None required.**

---

## Comment 2 & 4: PII in `http.url` tag (merged — same finding)

**Source:** Gemini (security-medium) + Codex (P1)
**Verdict: VALID**
**Severity: LOW**

### Reasoning

The error handler on the sentry branch (`packages/api/src/middleware/error.ts:345-346`) sets:

```typescript
scope.setTag('http.url', c.req.path);
```

Hono's `c.req.path` returns the **actual request path** with resolved parameter values (confirmed by usage at `app.ts:98`, `media.ts:60`), not the route pattern.

The `scrubEvent` function (`packages/api/src/lib/sentry-scrub.ts:119-144`) handles tags like this:

```typescript
if (scrubbed.tags) {
    const { server_name: __, ...cleanTags } = scrubbed.tags;
    scrubbed.tags = cleanTags;
}
```

This **only removes `server_name`** — it does NOT scrub PII from other tag values. So the bot comments are technically correct that tags are not scrubbed.

**However, practical severity is LOW, not P1/medium:**

1. **Route audit shows minimal PII exposure.** The only route params with JID-like values are `:groupJid` in 3 instance routes (`/instances/:id/groups/:groupJid/...`). Group JIDs are format `12345678@g.us` — they are group identifiers, NOT personal phone numbers. No routes have individual JIDs (`:jid`, `:phone`) in URL paths.
2. **Instance `:id` params are UUIDs** — not PII.
3. **Tags are only set on 5xx server errors** — not every request, limiting exposure volume.
4. The `requestDataIntegration` already strips IP, data, headers, query_string, and cookies.

### Minimal Fix

Add PII scrubbing to tag values in `scrubEvent` for defense-in-depth:

```typescript
// In scrubEvent, replace the tags block:
if (scrubbed.tags) {
    const { server_name: __, ...cleanTags } = scrubbed.tags;
    // Scrub PII from all tag values
    const scrubbedTags: Record<string, string> = {};
    for (const [k, v] of Object.entries(cleanTags)) {
        scrubbedTags[k] = scrubPii(v);
    }
    scrubbed.tags = scrubbedTags;
}
```

Alternatively, use `c.req.routePath` (Hono's route pattern) instead of `c.req.path` in the error handler to avoid sending resolved params entirely. But scrubbing tags is more robust as defense-in-depth.

---

## Comment 3: Phone regex too broad

**Source:** Gemini (medium)
**Verdict: VALID**
**Severity: LOW**

### Reasoning

The phone regex `PHONE_RE = /\+?\d{10,15}/g` will match any 10-15 digit sequence, including:
- Unix timestamps in milliseconds (13 digits)
- Large numeric IDs

The UUID preservation logic (`scrubPii` shelters UUIDs first) handles the most common false-positive case (hex-digit runs in UUIDs), but non-UUID numeric IDs could still be false-positived.

**Adding word boundaries would NOT break JID matching** — the JID regex runs before the phone regex, and in the character `1234567890@s.whatsapp.net`, the digit-to-`@` transition IS a word boundary (`\d` is `\w`, `@` is `\W`). So `\b\+?\d{10,15}\b` would work fine.

However, the practical impact is low because:
- False positives result in over-scrubbing (replacing a numeric ID with `[phone]`), which is annoying but not a security issue
- The current approach errs on the side of privacy (scrub more, not less)

### Minimal Fix (optional, low priority)

```typescript
const PHONE_RE = /\b\+?\d{10,15}\b/g;
```

---

## Comment 5: Double-counting agent dispatch metrics

**Source:** Codex (P2)
**Verdict: VALID**
**Severity: MEDIUM**

### Reasoning

The dispatch flow at `agent-dispatcher.ts:2416-2434` is:

```typescript
handled = await dispatchViaStreamingProvider(...);  // B-1a
if (!handled) {
    handled = await dispatchViaProvider(...);         // B-1b fallback
}
```

In `dispatchViaStreamingProvider` (lines 1451-1465):
- `consumeStream` is called, returns `streamResult` (true/false)
- Metrics (`agent.dispatch` count + latency) are recorded **regardless of streamResult value**
- `streamResult` is returned

In `dispatchViaProvider` (lines 1717-1728):
- Metrics (`agent.dispatch` count + latency) are recorded after `provider.trigger()`

**The double-count happens in this scenario:**
1. Streaming dispatch starts successfully
2. `consumeStream` returns `false` (e.g., error delta from timeout/circuit-breaker)
3. `dispatchViaStreamingProvider` records `agent.dispatch` count = 1
4. Returns `false` → caller falls through to `dispatchViaProvider`
5. `dispatchViaProvider` records `agent.dispatch` count = 1
6. **Total: 2 dispatches counted for 1 user message**

Note: the `catch` block (exception path) does NOT record metrics before returning false, so exception-based fallbacks don't double-count. Only the graceful `consumeStream → false` path double-counts.

### Minimal Fix

Only record metrics in the streaming path when the stream was successfully handled:

```typescript
// In dispatchViaStreamingProvider, change:
if (sentryEnabled()) {
// To:
if (streamResult && sentryEnabled()) {
```

This way, failed streams that trigger fallback don't count, and only the actual handling path (streaming OR accumulate) records the dispatch metric.

---

## Summary

| # | Finding | Verdict | Severity | Action |
|---|---------|---------|----------|--------|
| 1 | Hardcoded DSN | INVALID | NOISE | None — intentional OSS telemetry |
| 2+4 | PII in http.url tag | VALID | LOW | Scrub all tag values in `scrubEvent` |
| 3 | Phone regex too broad | VALID | LOW | Optional: add `\b` word boundaries |
| 5 | Double-counting metrics | VALID | MEDIUM | Guard streaming metrics with `if (streamResult && ...)` |

**Bottom line:** No critical or high-severity findings. One real bug (double-counting, MEDIUM), two defense-in-depth improvements (LOW). The DSN comment is noise — standard OSS pattern.
