# WISH: Agent Auto-Replay on Reconnect

> When API reconnects, automatically trigger agent responses for missed messages (with smart cutoffs)

**Status:** DRAFT
**Created:** 2026-02-10
**Author:** WISH Agent
**Beads:** omni-bkh

---

## Problem

**Current behavior:**
- API goes down → messages backfilled on reconnect → stored in DB but agents never respond

**User impact:**
- Customers send questions, never get answers
- Conversations drop silently

**Root cause:**
- Backfilled messages don't trigger `agent-dispatcher` (by design, to avoid spam)

---

## Solution (KISS)

### Core Behavior

**Auto-replay on reconnect:**
1. After instance connects, check for message gap
2. If gap exists, query missed messages (already in DB from backfill)
3. Re-publish as `message.received` events → triggers normal agent flow
4. Simple cutoff: **Don't replay messages older than 24 hours**

### Configuration (Instance Level)

Add to `instances` table:
```typescript
{
  agentReplayEnabled: boolean;           // default: true
  agentReplayMaxHours: number;          // default: 24
}
```

### Manual Override (CLI)

```bash
# Replay all missed messages for an instance
omni messages replay --instance <id>

# Override time window
omni messages replay --instance <id> --max-hours 48

# Specific chat only
omni messages replay --instance <id> --chat <chatId>
```

---

## Assumptions

**ASM-1:** Messages are already backfilled by existing system
**ASM-2:** Re-publishing as `message.received` won't cause duplicate DB entries (message-persistence uses `findOrCreate`)
**ASM-3:** 24 hours is a good default for most use cases
**ASM-4:** Instance-level config is sufficient (no per-chat needed)

---

## Decisions

**DEC-1:** Auto-replay ON by default (opt-out, not opt-in)
**DEC-2:** 24-hour cutoff by default (configurable)
**DEC-3:** Full stack implementation - API → SDK → CLI → UI (consistency principle)
**DEC-4:** Replay ALL message types (text, media, reactions) - no filtering
**DEC-5:** No deduplication tracking - rely on event idempotency

---

## Risks

**RISK-1:** Spam risk if misconfigured
- **Mitigation:** Conservative 24h default, per-instance disable flag

**RISK-2:** Race condition if messages come during replay
- **Mitigation:** Use timestamp ordering, agent-dispatcher already handles buffering

**RISK-3:** Rate limits on rapid replay
- **Mitigation:** Reuse existing debouncing in agent-dispatcher

---

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| db | schema | Add `agentReplayEnabled`, `agentReplayMaxHours` to instances |
| api | services, plugins, routes | Replay logic in new service + API endpoint |
| sdk | regenerate | New instance fields + replay endpoint |
| cli | commands | `omni messages replay` command |
| ui | components, pages | Instance settings + manual replay button |

### System Checklist
- [ ] **Events**: No new events (reuse `message.received`)
- [ ] **Database**: Add 2 columns to instances table
- [ ] **API**: New replay endpoint + instance fields updated
- [ ] **SDK**: Regenerate for new fields + endpoint
- [ ] **CLI**: New `messages replay` command
- [ ] **UI**: Instance settings page + manual replay controls
- [ ] **Tests**: Service tests, integration test, UI tests

---

## Scope

### IN SCOPE
- ✅ Auto-replay on reconnect (behind instance flag)
- ✅ Configurable time cutoff per instance
- ✅ CLI command for manual replay
- ✅ UI controls in instance settings
- ✅ UI manual replay button per chat/instance
- ✅ Simple validation (max hours, enabled check)

### OUT OF SCOPE
- ❌ Per-chat replay settings (instance-level only)
- ❌ Message type filtering (replay all or none)
- ❌ Replay analytics dashboard (beyond standard logs)
- ❌ Deduplication tracking table
- ❌ Advanced scheduling/automation

---

## Execution Blueprint

### Group A: Core Replay Service

**Goal:** Implement message replay logic

**Packages:** `api`, `db`

**Deliverables:**
1. Add DB columns: `agentReplayEnabled`, `agentReplayMaxHours`
2. Create `MessageReplayService`:
   - `replayMissedMessages(instanceId, options?)`
   - Query messages within time window
   - Re-publish as `message.received` events
3. Hook into instance.connected event
4. Update instance API routes if needed

**Acceptance Criteria:**
- [ ] Service can query missed messages from DB
- [ ] Service publishes events that trigger agent-dispatcher
- [ ] Respects `agentReplayEnabled` flag
- [ ] Respects `agentReplayMaxHours` cutoff
- [ ] Logs replay activity

**Validation:**
```bash
make db-push           # Apply schema
make check             # Types + lint
bun test packages/api  # Service tests
```

---

### Group B: CLI Command

**Goal:** Manual replay trigger

**Packages:** `cli`, `sdk`

**Deliverables:**
1. Command: `omni messages replay`
   - `--instance <id>` (required)
   - `--max-hours <hours>` (optional, override)
   - `--chat <chatId>` (optional, filter)
2. Regenerate SDK if needed

**Acceptance Criteria:**
- [ ] Command calls replay service via API
- [ ] Shows summary (X messages replayed)
- [ ] Handles errors gracefully
- [ ] Help text clear

**Validation:**
```bash
bun generate:sdk      # If API changed
omni messages replay --help
```

---

### Group C: UI Implementation

**Goal:** Instance settings + manual replay controls

**Packages:** `ui`

**Deliverables:**
1. Instance Settings Page:
   - Toggle: "Auto-replay missed messages" (agentReplayEnabled)
   - Input: "Max replay window (hours)" (agentReplayMaxHours)
   - Info text explaining behavior
2. Manual Replay Controls:
   - Button in instance details: "Replay Missed Messages"
   - Optional: Per-chat replay button (if time permits)
   - Shows confirmation + result summary

**Acceptance Criteria:**
- [ ] Settings page updates instance config via SDK
- [ ] Manual replay button calls SDK replay endpoint
- [ ] Shows loading state during replay
- [ ] Displays success/error feedback
- [ ] Help text explains 24h default

**Validation:**
```bash
cd apps/ui
bun dev
# Manual UI testing
```

---

### Group D: Integration Test

**Goal:** Verify end-to-end flow

**Packages:** `api`

**Deliverables:**
1. Integration test:
   - Simulate downtime (insert old messages)
   - Trigger reconnect → verify auto-replay
   - Verify agent responds to replayed messages
   - Verify 24h cutoff works

**Acceptance Criteria:**
- [ ] Test covers auto-replay on reconnect
- [ ] Test covers manual CLI replay
- [ ] Test covers time cutoff boundary
- [ ] Test verifies no duplicates

**Validation:**
```bash
bun test packages/api/__tests__/message-replay.test.ts
```

---

## Next Steps

1. **Review this wish** - Does full-stack approach work?
2. **Ready to forge?** - Run `/forge` when approved
3. **Track progress** - `bd show omni-bkh`

---

## Architecture Principle

> **"API → SDK → CLI → UI"**
>
> Everything the API has, the SDK exposes, the CLI commands, and the UI controls.
> This ensures consistency and completeness across all layers.
