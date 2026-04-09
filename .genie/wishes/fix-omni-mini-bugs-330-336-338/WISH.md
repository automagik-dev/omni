---
slug: fix-omni-mini-bugs-330-336-338
title: "Fix three mini-bugs: vCard waid (#330), reaction echo loop (#336), omni connect typo (#338)"
status: ready
priority: P1
github_issues: [330, 336, 338]
---

## Context

Three independent bugs with complete root cause + fix sketches already captured in their issue bodies. Bundled into one wish because they're all small, independent, and touch different files — one engineer can knock them all out in under a day.

## Bug 1 — #330: vCard missing `waid` field (HIGH severity)

### Problem
Contact cards sent via `omni send --contact` are not clickable on WhatsApp — the "Conversar" button doesn't appear. Users have to manually copy the number. Critical for handoff workflows where human consultants need to contact leads.

### Root Cause
`buildVCard()` in the WhatsApp Baileys plugin generates:
```
TEL;type=CELL:+5511960008976
```
But WhatsApp needs `waid` to link the contact:
```
TEL;type=CELL;waid=5511960008976:+5511960008976
```
The `waid` is the phone in JID format (country+area+number, no `+`, and for BR mobile: **strip the leading 9 after area code** — 13→12 digit format).

### Fix Site
`buildVCard` in the WhatsApp Baileys plugin. Find it via:
```bash
grep -rn "buildVCard\|BEGIN:VCARD" packages plugins --include='*.ts'
```

### Solution Sketch (from issue body)
```typescript
buildVCard(contact) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${contact.name}`];
  if (contact.phone) {
    const digits = contact.phone.replace(/[^\d]/g, '');
    let waid = digits;
    // BR mobile normalization: 13-digit (55 + 2 area + 9 + 8) → 12-digit (no leading 9)
    if (digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9') {
      waid = digits.slice(0, 4) + digits.slice(5);
    }
    lines.push(`TEL;type=CELL;waid=${waid}:${contact.phone}`);
  }
  // ... rest unchanged
}
```

### Tests
- Unit test: 13-digit BR mobile (`+5511960008976`) → waid `551160008976` (strips the 9)
- Unit test: 12-digit BR mobile (`+551160008976`) → waid `551160008976` (unchanged)
- Unit test: US number (`+14155551234`) → waid `14155551234` (no BR normalization)
- Unit test: International with no country code → verify safe fallback
- Unit test: Empty/null phone → no TEL line added

---

## Bug 2 — #336: Reaction echo causes dispatch loop (HIGH severity)

### Problem
When `reactionAck: on`, bot's own 👀 reaction echoes back from WhatsApp and gets re-dispatched to the agent, causing 2-3x response loops until rate limiter cuts it off.

### Root Cause (3 compounding defects)

1. **`handleReactionReceived()` in WhatsAppPlugin** — emits `message.received` for **every** reaction regardless of `isFromMe`. Guarded only by `OMNI_DUAL_EMIT_REACTIONS` env flag (default true), not by self-check.

2. **`shouldProcessMessage2()` in channel-whatsapp** — filters `fromMe` for regular messages upsert via `isBotSentMessage()` cache, but **doesn't run for `messages.reaction`** events. Reactions bypass the filter.

3. **`shouldProcessMessage3()` in agent-dispatcher.ts** — self-filter compares `payload.from` (a JID like `63750317031625@lid`) against `metadata.platformIdentityId` (a UUID). Different formats → never matches → filter is a no-op for WhatsApp.

### Fixes (all three required for defense in depth)

1. **Filter `fromMe` reactions in `handleReactionReceived`** — skip dual-emit when `isFromMe === true`. This is the primary fix.

2. **Track reactionAck message IDs in the `sentMessageIds` cache** so `shouldProcessMessage2` can filter them too.

3. **Fix `shouldProcessMessage3` self-filter** — resolve the JID to the instance owner identifier (or skip the UUID comparison entirely when the channel is WhatsApp). Check how `ownerIdentifier` is available on the instance context.

### Tests
- Unit test: `handleReactionReceived` with `isFromMe=true` → no emit
- Unit test: `handleReactionReceived` with `isFromMe=false` → emit as before
- Unit test: `shouldProcessMessage3` with JID that matches the instance's owner JID → returns null
- Regression: turning `reactionAck: on` no longer produces dispatch loops in an end-to-end scenario (can mock)

### Location hints
```bash
grep -rn "handleReactionReceived\|shouldProcessMessage2\|shouldProcessMessage3\|OMNI_DUAL_EMIT_REACTIONS" packages plugins --include='*.ts'
```

---

## Bug 3 — #338: `omni connect` uses wrong genie CLI command (MEDIUM severity, XS effort)

### Problem
```
$ omni connect 60a466a7-... eugenia-seller
ℹ Discovering agent "eugenia-seller" from genie directory...
Error (genie dir): error: unknown command 'get'
✗ Failed to discover agent "eugenia-seller" from genie directory.
```

### Root Cause
`packages/cli/src/commands/connect.ts` calls `genie dir get <name>` which doesn't exist. The correct command is `genie dir ls <name> --json` or `genie agent directory <name> --json`.

### Fix
Replace the `genie dir get` invocation with `genie dir ls <name> --json` in `packages/cli/src/commands/connect.ts`. Verify with:
```bash
genie dir ls eugenia-seller --json  # should return agent info
```

### Tests
- Update any existing connect.ts test to use the new command
- If no test exists, add a minimal one that mocks the subprocess and asserts the correct argv

---

## Execution Groups

### Group 1 — Fix #338 (engineer, XS, ~10 min)
- Edit `packages/cli/src/commands/connect.ts`
- Replace `genie dir get` with `genie dir ls --json`
- Add or update unit test
- Run validation locally

### Group 2 — Fix #330 (engineer, S, ~30 min)
- Locate `buildVCard` in WhatsApp Baileys plugin
- Apply the waid fix with BR mobile normalization
- Add 5 unit tests covering BR/US/unchanged/international/empty cases
- Run validation locally

### Group 3 — Fix #336 (engineer, M, ~2 h)
- Apply all three fixes (reaction self-filter, cache tracking, JID-based self-check)
- Add tests for each layer
- Verify rate limiter still works as safety net (don't remove it)
- Run validation locally

### Group 4 — Validation + PR (reviewer)
- `bun run build` across all packages
- `bunx biome check .`
- `bunx knip` (avoid regressing the Gupshup fix if that PR merges first)
- `bun test` — no new failures
- Commit each bug as its own conventional commit so reverting is easy:
  - `fix(channel-whatsapp): add waid to vCard TEL line for clickable contact cards (#330)`
  - `fix(channel-whatsapp): filter bot's own reactions to prevent dispatch loops (#336)`
  - `fix(cli): use 'genie dir ls --json' instead of non-existent 'get' subcommand (#338)`
- Push branch
- Open PR targeting `dev` with title: `fix: mini-bugs bundle — vCard waid, reaction echo loop, connect typo (#330 #336 #338)`
- PR body lists each bug with link to its issue and the commit
- Report PR URL to omni

## Acceptance Criteria

- [ ] #330: vCard includes `waid=<digits>` on TEL line; BR mobile 13→12 normalization correct
- [ ] #336: Bot's own reactions do not trigger dispatch loops; verified with unit tests at all three layers
- [ ] #338: `omni connect <instance> <agent>` successfully discovers agent from genie directory
- [ ] All three bugs have unit test coverage
- [ ] `bun run build` + `bunx biome check .` + `bunx knip` + `bun test` all clean
- [ ] PR opened targeting `dev`, linking to #330, #336, #338

## Validation Commands

```bash
cd /home/genie/.genie/worktrees/omni/fix-mini-bugs
bun run build
bunx biome check .
bunx knip
bun test packages/channel-whatsapp packages/cli
grep -n "waid" packages/channel-whatsapp/src/**/*.ts
grep -n "genie dir ls" packages/cli/src/commands/connect.ts
```

## Risk

- **Blast radius:** All three fixes are surgical. #336 touches WhatsApp reaction path which has more logic — ensure the fix doesn't break normal user reactions being dispatched (they should still work, only bot's own reactions should be filtered).
- **Rollback:** Each bug is a separate commit — revert individually if any proves problematic.

## References

- #330: https://github.com/automagik-dev/omni/issues/330 — vCard missing waid
- #336: https://github.com/automagik-dev/omni/issues/336 — reaction echo loop
- #338: https://github.com/automagik-dev/omni/issues/338 — omni connect typo
