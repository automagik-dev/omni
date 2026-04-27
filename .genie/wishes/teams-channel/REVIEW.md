# Deep Review — `@omni/channel-teams` (PR #543)

Prepared: 2026-04-27
Branch: `teams-channel`
Reviewer: `teams-jwt-fix` (independent post-PR audit)

This report consolidates two reviews:

1. **Gemini Code Assist** (4 inline findings on PR #543, HIGH × 3 + MEDIUM × 1)
2. **Independent deep audit** of the package against `@omni/channel-slack`,
   `@omni/channel-telegram`, and `@omni/channel-sdk` contracts.

Format per finding: `severity • file:line • title` followed by *Reason*,
*Repro / Evidence*, and *Fix / Decision*.

---

## A. Gemini findings (PR review)

### A.1 — HIGH • `src/plugin.ts:529` • `serviceUrls` keyed by wrong identifier

**Reason.** In Teams channels, `activity.conversation.id` is the *thread*
ID (e.g. `19:xxxx@thread.tacv2;messageid=N`), but downstream `sendMessage`
looks up `serviceUrls.get(chatId)` where `chatId` is `channelData.channel.id`
for channel posts (per `deriveChatId`). The map writes under conversation.id,
the read uses channel.id ⇒ misses ⇒ falls back to `state.config.serviceUrl`
or throws `SEND_FAILED`.

**Fix.** Mirror `deriveChatId` when storing.

```ts
if (activity.serviceUrl && activity.conversation?.id) {
  const chatId =
    activity.conversation.conversationType === 'channel' && activity.channelData?.channel?.id
      ? activity.channelData.channel.id
      : activity.conversation.id;
  state.serviceUrls.set(chatId, activity.serviceUrl);
}
```

**Status:** APPLIED.

---

### A.2 — HIGH • `src/plugin.ts:572` • `lastActivityIds` keyed by wrong identifier

**Reason.** Same shape as A.1. `sendMessage` resolves `replyToId` via
`state.lastActivityIds.get(conversationId)` where `conversationId` is the
caller-supplied chatId. The map writes under `meta.conversationId`. For
channel posts those differ; `replyToMode: 'all'` silently degrades to "no
reply".

**Fix.**

```ts
state.lastActivityIds.set(parsed.chatId, parsed.meta.activityId);
```

**Status:** APPLIED.

---

### A.3 — HIGH • `src/senders/text.ts:59` • Chunked messages break threading in channels

**Reason.** In Teams channels a `message` activity sent to a channel id
*without* a `replyToId` starts a **new thread**. The current loop only
threads chunk 0; chunks 1..N–1 are emitted with `replyToId: undefined` and
each appears as a fresh thread root. Long messages arrive as a tree of
fragments instead of a single threaded conversation.

**Fix.** Every chunk threads to a stable anchor: if the caller passed
`replyToId`, all chunks reply there; otherwise chunks 1..N reply to chunk 0
to keep the chain linear.

```ts
const chunkReplyToId = i === 0 ? options.replyToId : (options.replyToId ?? lastActivityId);
```

**Status:** APPLIED.

---

### A.4 — MEDIUM • `src/plugin.ts:463` • `fakeRes` shim drops headers

**Reason.** `CloudAdapter.process` calls `res.header(name, value)` for
`invoke`-activity responses (e.g. `Content-Type: application/json` for an
`invokeResponse`). The current shim is a no-op for `header()`; the
returned `Response` therefore omits content-type, which Teams clients and
the Bot Framework Connector parse leniently for now but may reject in the
future.

**Fix.** Capture headers and propagate.

```ts
const captured: { status: number; body?: string; headers: Record<string, string> } = {
  status: 200,
  headers: {},
};
// status / send / end / header all push into `captured`
return new Response(captured.body ?? '', { status: captured.status, headers: captured.headers });
```

**Status:** APPLIED.

---

## B. Independent audit findings

### B.1 — HIGH • `src/capabilities.ts:36-37` + `src/tools.ts:55-71` • Capability matrix lies about edit/delete

**Reason.** `TEAMS_CAPABILITIES` declares `canEditMessage: true` and
`canDeleteMessage: true`, but `tools.editMessage` and `tools.deleteMessage`
both throw `TeamsError(UNSUPPORTED_ACTIVITY, '... not implemented in the
Group 2 skeleton — see WISH.md Group 3/4')`. Any caller that trusts the
capability matrix to route an edit will hit `UNSUPPORTED_ACTIVITY` at
runtime — silent at `bun test` time, loud at production-call time.

DESIGN §6 leaves edit/delete as a follow-up. The honest v1 declaration is
to mark these capabilities `false` until the wire calls
(`updateActivity` / `deleteActivity`) ship. The `tools.ts` stubs can stay
as `NOT_IMPLEMENTED` — flipping the capability prevents the dispatcher from
ever entering that path.

**Fix.** `canEditMessage: false` / `canDeleteMessage: false` + sync the
header comment in `capabilities.ts`.

**Status:** APPLIED.

---

### B.2 — MEDIUM • `src/tools.ts:30-50` • `addReaction` / `removeReaction` stubs are dead but exported

**Reason.** `TeamsPlugin.react()` / `unreact()` already deliver real
behaviour via `senders/reaction.ts`. The `tools.ts` `addReaction` /
`removeReaction` stubs throw `NOT_IMPLEMENTED` and are exported from
`index.ts`. Any external consumer wiring through the tool surface gets a
crash even though the plugin can do the work.

**Decision.** *Defer.* The dispatcher currently goes through the plugin
methods, not the tool exports. Wiring the tools to call into the plugin
needs an instance handle the tools layer doesn't currently receive — that's
a small refactor (a few lines) but it expands API surface and review
scope. Logged as TODO; track in a follow-up wish.

**Status:** DOCUMENTED. Not applied.

---

### B.3 — MEDIUM • `src/plugin.ts:96-99` • Per-instance maps grow unbounded

**Reason.** `state.serviceUrls` and `state.lastActivityIds` accumulate one
entry per distinct chat id seen on inbound activities. There is no LRU,
no TTL, no `clear()` outside `disconnect()`. A long-running bot in a busy
tenant accrues memory linearly with the number of channels/DMs it has
seen.

Slack has the same shape but the maps in question (e.g. `userInfoCache`)
are bounded by the number of *active* users, not channels seen. Telegram
does not maintain a comparable map.

**Decision.** *Defer.* Real-world cardinality is bounded (a tenant has
O(thousands) of channels at most, each entry is ~100 bytes). Not a v1
concern. Logged as TODO; revisit if memory profiling flags it.

**Status:** DOCUMENTED. Not applied.

---

### B.4 — LOW • `src/handlers/conversation.ts:42-54` • `toActivityMeta` throws on missing fields

**Reason.** `parseInboundMessage` calls `toActivityMeta` which throws if
`id`, `conversation.id`, `serviceUrl`, or `from.id` are missing.
`handleWebhook` wraps this in a try/catch that logs `[teams] activity
dispatch failed`, so we don't 500. But the throw aborts the dispatch
silently from the caller's perspective — Bot Framework probes (e.g. an
`invoke` from a malformed test harness) end up as `error` log lines.

**Decision.** *Defer.* The current behaviour is correct (drop on
malformed). Switching to `null` returns would be cleaner; logged as a
NIT, not worth the churn for v1.

**Status:** DOCUMENTED. Not applied.

---

### B.5 — LOW • `src/plugin.ts:540-555` • `messageUpdate` / `messageDelete` not handled

**Reason.** DESIGN §5.6 says: "v1: emit them but downstream may treat as
no-op." The current dispatcher folds them into the same default branch as
`typing`/`event`/`invoke` — debug log + drop. There is no
`emitMessageEdited` / `emitMessageDeleted` plumbing yet.

**Decision.** *Defer.* The SDK does not yet expose those emitters; adding
them requires SDK work outside the channel package. Logged as a follow-up
wish.

**Status:** DOCUMENTED. Not applied.

---

### B.6 — NIT • `src/plugin.ts:511` • `as unknown as TeamsCloudAdapter` cast in `buildCloudAdapter`

**Reason.** The cast hides shape divergence between the real `CloudAdapter`
class and our `TeamsCloudAdapter` interface. Functionally fine because the
interface is a strict subset, but the double-cast smells.

**Decision.** *Defer.* The interface is intentionally narrow so tests can
substitute a fake; a tighter binding would couple production to test
seams. Acceptable trade-off.

**Status:** DOCUMENTED. Not applied.

---

### B.7 — NIT • `src/plugin.ts:438` • Authorization header lookup is case-redundant

**Reason.** `request.headers.get('authorization') ?? request.headers.get('Authorization')`.
Standard `Headers` lookup is already case-insensitive — the second branch
is never hit.

**Decision.** *Defer.* Cheap belt-and-suspenders, harmless. Could trim in
a future cleanup.

**Status:** DOCUMENTED. Not applied.

---

## C. Cross-channel consistency check (vs `channel-slack`, `channel-telegram`)

| Concern | Slack | Telegram | Teams (this PR) | Verdict |
|---|---|---|---|---|
| Subdir layout (`handlers/`, `senders/`, `connection/`) | ✅ | ✅ (no `connection/`) | ✅ | OK |
| `BaseChannelPlugin` lifecycle (initialize / connect / disconnect) | ✅ | ✅ | ✅ | OK |
| `handleWebhook` returns `Response` | ✅ | ✅ | ✅ | OK |
| Per-instance state Map keyed correctly by chat id | ✅ | n/a | ❌ → ✅ (after A.1/A.2) | Fixed |
| Chunked text threading via stable anchor | ✅ (`thread_ts` for all chunks) | n/a (no chunking) | ❌ → ✅ (after A.3) | Fixed |
| Webhook auth (signature / JWT) | ✅ HMAC | ✅ secret token | ❌ → ✅ (commit 2) | Already fixed |
| Capability matrix matches implementation | ✅ | ✅ | ❌ → ✅ (after B.1) | Fixed |
| Logger usage (`@omni/core` `Logger`) | ✅ | ✅ | ✅ | OK |
| Custom error class with channel-specific code | ✅ `SlackError` | ✅ `TelegramError` | ✅ `TeamsError` | OK |
| Tests per handler / sender (happy + error) | ✅ | ✅ | ✅ (163 tests) | OK |
| Tests for new fixes | n/a | n/a | ✅ added in this round | OK |
| JSDoc tone (explain *why*) | ✅ | ✅ | ✅ (slightly verbose but consistent) | OK |

No structural divergence found beyond the items called out as findings.

---

## D. Socket-Security alert — `npm/entities@4.5.0`

**Alert.** Socket flags `entities@4.5.0` (transitive of `botbuilder` →
`htmlparser2`/`parse5`-style ecosystem) as 91% likely obfuscated.

**Investigation.**

- `entities` is a long-running, well-known HTML/XML entity codec maintained
  by `fb55` (Felix Böhm) — author of `cheerio`, `htmlparser2`, `domhandler`,
  `domutils`. Used by `parse5`, `dom-serializer`, `lit-html`, etc.
- Source: https://github.com/fb55/entities
- The `lib/maps/decode.json` and `lib/maps/entities.json` lookup tables it
  ships are *large* JSON blobs of named-entity codepoints (e.g. `&amp;` →
  `&`). Static analysis sees those compact JSON tables and scores high on
  entropy / obfuscation heuristics. This is a known false-positive vector
  for Socket on entity / charset libraries.
- `bun pm ls --all` confirms the dependency chain:
  `botbuilder@4.23.3 → @azure/msal-node@... → ... → entities@4.5.0`
  (transitive only — we never import it directly).
- `entities` has no postinstall script and no native bindings; the public
  API surface is pure functions.

**Decision.** Accept as false positive. No override required.
- Documented inline in the PR comment.
- If audit policy ever requires zero "high" Socket alerts we can pin a
  newer `entities` (≥6.x) via `bun.lock` overrides — but we'd be diverging
  from `botbuilder`'s tested transitive set, and the alert source is the
  data-table shape, not the version, so the override would not change the
  Socket score.

**Status:** DOCUMENTED. No code change.

---

## E. Summary

| Severity | Count | Applied | Deferred |
|---|---|---|---|
| BLOCKER | 0 | — | — |
| HIGH (Gemini) | 3 | 3 | 0 |
| HIGH (own audit) | 1 | 1 | 0 |
| MEDIUM (Gemini) | 1 | 1 | 0 |
| MEDIUM (own audit) | 2 | 0 | 2 |
| LOW | 2 | 0 | 2 |
| NIT | 2 | 0 | 2 |
| Socket | 1 | n/a (FP) | n/a |

**Total applied:** 5 (4 Gemini + 1 own HIGH).
**Total deferred:** 6 (logged with rationale; reviewable as follow-ups).

Regression tests added for every applied fix in
`src/__tests__/gemini-fixes.test.ts` (and adjustments to existing test
files where the contract under test changed).
