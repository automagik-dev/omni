# Omni v2 — Release Process

> **Audience:** release engineers (human or agent) promoting `dev` → `main`.
> **Frequency:** on demand, typically weekly.
> **Owner:** whoever holds the release-engineer role for the cut.
> **Inputs:** a green `dev` branch, rolling PR `dev → main` (auto-created).
> **Outputs:** new `main` tag, production redeploy, post-deploy smoke report.

This document is **versioned** alongside the code it governs. Changes to the release process are proposed via PR against `dev` like any other change.

---

## Table of Contents

1. [Philosophy — why a structured release process](#1-philosophy)
2. [Pre-Release Pipeline](#2-pre-release-pipeline)
   - 2.1 [Dual-instance comparison testing](#21-dual-instance-comparison-testing)
   - 2.2 [CLI validation matrix](#22-cli-validation-matrix)
   - 2.3 [API smoke tests](#23-api-smoke-tests)
   - 2.4 [SDK validation](#24-sdk-validation)
3. [The Omni Toolkit — design document](#3-the-omni-toolkit--design-document)
4. [Release Day Runbook](#4-release-day-runbook)
5. [Breaking Changes Communication](#5-breaking-changes-communication)
6. [Proposed Makefile additions](#6-proposed-makefile-additions)

---

## 1. Philosophy

Omni ships via a **rolling PR** (`dev → main`, kept open continuously). Any dev commit that lands cleanly and passes CI is a candidate for promotion. A release is not "cut a branch"; a release is "merge the rolling PR at a moment when dev is provably safe to be main."

Our release process exists to answer one question before merging that PR:

> *Has the dev candidate been proven to behave at least as well as production main?*

Everything in this document is structured to answer that question with evidence, not vibes.

The gate is a single artifact — `docs/releases/v2-release-readiness-<date>.md` — written by the release engineer each time. It is *not* a checklist that passes or fails in the abstract; it is a comparison report. Production behavior is the baseline. The dev candidate must match or improve on it.

---

## 2. Pre-Release Pipeline

Run these in order. Each step has a clear pass/fail signal and a logged artifact.

### 2.1 Dual-instance comparison testing

**The core release signal.** We run two Omni instances side by side and drive identical inputs into both. Any unexpected behavioral delta is either an expected improvement (documented) or a regression (blocks release).

#### Topology

```
                  ┌──────────────────┐              ┌──────────────────┐
  WhatsApp tests  │  Instance A      │              │  Instance B      │  WhatsApp tests
    (number Aᵢ)   │  from ~/prod/omni│              │  from ~/dev/omni │    (number Bᵢ)
  ────────────►   │  branch: main    │              │  branch: dev     │  ────────────►
                  │  port: 8080      │              │  port: 18080     │
                  │  PG: omni_main   │              │  PG: omni_rc     │
                  │  NATS: omni-main │              │  NATS: omni-rc   │
                  └──────────────────┘              └──────────────────┘
                           │                                 │
                           └────── compare outputs ──────────┘
                                        │
                               agent replies / timing /
                               follow-up behavior /
                               session lifecycle
```

**Requirements:**
- **Separate databases.** Never share a Postgres instance between A and B. Migration state diverges by design. Use `POSTGRES_DB=omni_main` and `POSTGRES_DB=omni_rc`.
- **Separate NATS streams.** Use distinct NATS stream name prefixes (e.g., `OMNI_MAIN_*` vs `OMNI_RC_*`) to avoid cross-consumption.
- **Separate WhatsApp numbers.** Use two test numbers (e.g., `testonho-main` and `testonho-rc`) or two separate Baileys sessions. Do **not** multiplex one number — Baileys state will fight itself.
- **Pointed at the same agent.** Both instances call the same agent provider (agno / claude-code / openclaw). Otherwise the comparison is meaningless.

#### Bootstrap (proposed `make release-bootstrap-dual`)

```bash
# Brings up both instances from their respective worktrees.
# Assumes ~/prod/omni is checked out to latest main,
#         ~/dev/omni  is checked out to latest dev.
make release-bootstrap-dual

# Tears down both instances cleanly.
make release-teardown-dual
```

Implementation outline (`scripts/release/bootstrap-dual.sh`):
1. For each of `~/prod/omni` (A) and `~/dev/omni` (B):
   - Build a `.env.release-A` / `.env.release-B` with isolated ports, DB names, NATS prefixes, and PM2 process names.
   - Run `pm2 start ecosystem.config.cjs --only omni-api --env release-A` (and -B).
   - Wait for `/health` on each.
2. Publish connection info (port, WhatsApp number, default agent) to `/tmp/release-dual-state.json`.

#### Comparison scenarios (proposed `make release-compare`)

Run a scripted conversation against both numbers. Minimum 5 scenarios:

| Scenario | Messages sent | What to compare |
|---|---|---|
| S1. Simple greeting | `"oi"` → agent reply | Response text, latency, session created |
| S2. Agent thinking | `"me fale sobre X"` (requires tool use) | Tool call count, final text, timing |
| S3. Follow-up arming | Message pair, wait > follow-up threshold | Whether follow-up fires on B, does not fire on A if feature disabled, timing |
| S4. Session clear | Send trash emoji `"🗑️"` | Whether session resets, whether follow-ups disarm |
| S5. Large payload | 10KB text message | Whether split-message delay fires, order preserved |

For each scenario, record both outputs to `docs/releases/dual-compare-<date>/<scenario>.md` with:
- Raw response from A (current prod)
- Raw response from B (release candidate)
- Latency delta
- Verdict: `MATCH` / `IMPROVED` / `REGRESSION`

**Release rule:** zero `REGRESSION` verdicts without an explicit waiver in the readiness gate doc.

#### Non-goals for v1

- Automated semantic diff of agent replies (LLM-judged equivalence). Phase 2 — for now, human reads the diff.
- Load testing. Separate from release gate.

### 2.2 CLI validation matrix

Run against Instance B (release candidate). Every command must return expected status and shape.

| # | Command | Expected | Automation |
|---|---|---|---|
| 1 | `omni config show` | Returns JSON with `baseUrl`, `apiKey` | ✅ assert non-empty |
| 2 | `omni instances list --json` | Array of instances | ✅ assert array, assert `isConnected` boolean |
| 3 | `omni instances create --name rc-test --channel whatsapp --json` | 201 + instance record | ✅ capture `id` for follow-on tests |
| 4 | `omni instances get <id> --json` | 200 + single record with `id` matching | ✅ assert id match |
| 5 | `omni instances update <id> --message-split-delay-min-ms 500 --json` | 200 + updated record | ✅ assert delay value persisted |
| 6 | `omni chats list --instance <id> --json` | Array (possibly empty) | ✅ assert array, assert each has `isGroup: boolean` (fix #403) |
| 7 | `omni chats messages <chatId> --json` (if chat exists) | Array of messages | ✅ assert array |
| 8 | `omni agents list --json` | Array of agents | ✅ assert array |
| 9 | `omni agents create --name rc-agent --provider <prov> --model <m> --json` | 201 + agent record | ✅ capture `id` |
| 10 | `omni agents update <id> --provider-agent-id foo --config-path ./x.yaml --metadata '{"k":"v"}' --json` | 200 + updated record | ✅ assert all three fields persisted |
| 11 | `omni events list --since 1h --json` | Array of events | ✅ assert array |
| 12 | `omni events stream --instance <id>` (short run) | Tails events, exits on SIGINT | ⚠️ manual or timed |
| 13 | `omni follow-up set --instance <id> --config @./follow-up.json` | 200 + config persisted | ✅ assert `follow_up_config` populated |
| 14 | `omni follow-up get --instance <id> --json` | 200 + config | ✅ assert matches input |
| 15 | `omni access create --instance <id> --chat-uuid <cu> --user-phone <up>` | 200 + access rule | ✅ assert rule shape |
| 16 | `omni send --instance <id> --to <phone> --text "rc-smoke"` | 200 + message id | ✅ assert message id non-empty |
| 17 | `omni instances delete <id>` | 200 + confirmation | ✅ cleanup, assert `.status === 'deleted'` |
| 18 | `omni agents delete <id>` | 200 + confirmation | ✅ cleanup |

**64KB pipe test (fix `3c037710`):** `omni events list --since 24h --json | jq '.[0]' | wc -c` — must return a non-zero byte count without truncation. Regression would print `0` or truncate mid-object.

**Automation target (proposed):**

```bash
make release-validate-cli
# Runs all 18 commands above in order, writes results to
# docs/releases/cli-validation-<date>.json with pass/fail per row.
# Implementation: scripts/release/validate-cli.ts driven by Bun.
```

### 2.3 API smoke tests

Direct HTTP calls against Instance B. Tests the OpenAPI surface independent of the CLI.

| # | Method + Path | Expected status | Shape assertion |
|---|---|---|---|
| 1 | `GET /health` | 200 | `{ status: "ok" }` |
| 2 | `GET /api/instances` | 200 | `[{ id, name, channel, isConnected, ... }]` |
| 3 | `POST /api/instances` body `{name, channel}` | 201 | `{ id, ... }` |
| 4 | `GET /api/instances/:id` | 200 | full instance record |
| 5 | `PATCH /api/instances/:id` body `{messageSplitDelayMinMs: 500}` | 200 | updated record includes the field |
| 6 | `GET /api/chats?instanceId=<id>&isGroup=false` | 200 | filtered array |
| 7 | `GET /api/chats?instanceId=<id>&isGroup=true` | 200 | group chats only |
| 8 | `GET /api/messages?chatId=<cu>&limit=1` piped to `jq '.[] \| .text'` with payload ≥ 64KB | 200 | no truncation |
| 9 | `POST /api/reactions` body `{chatId, messageId, emoji}` | 200 | reaction recorded |
| 10 | `GET /api/follow-up/config?instanceId=<id>` | 200 | current config or `null` |
| 11 | `POST /api/follow-up/config` body `{instanceId, config}` | 200 | persisted |
| 12 | `DELETE /api/follow-up/config?instanceId=<id>` | 200 | cleared |
| 13 | `GET /api/handoffs/logs?instanceId=<id>&limit=10` | 200 | `[{ id, sentAt, toPhone, text, ... }]` |
| 14 | `POST /api/instances/:id/gupshup/users/:phone/toggle-agent` (gupshup only) | 200 | toggle result |

**Automation target (proposed):**

```bash
make release-validate-api
# Runs the matrix above via curl+jq or a Bun script. Reports pass/fail.
```

### 2.4 SDK validation

The generated SDK is only useful if external consumers can actually import it and it compiles against the current API surface. Run three representative operations.

```typescript
// scripts/release/validate-sdk.ts
import { OmniClient } from '@omni/sdk';

const client = new OmniClient({
  baseUrl: process.env.OMNI_RC_URL!,      // e.g. http://localhost:18080
  apiKey:  process.env.OMNI_RC_API_KEY!,
});

// Op 1: list
const instances = await client.instances.list();
console.assert(Array.isArray(instances));

// Op 2: create + read-back
const created = await client.instances.create({ name: 'sdk-rc', channel: 'whatsapp' });
console.assert(created.id);
const fetched = await client.instances.get(created.id);
console.assert(fetched.id === created.id);

// Op 3: send (end-to-end — requires connected instance, skip if not)
if (fetched.isConnected) {
  const msg = await client.send({ instanceId: fetched.id, to: process.env.TEST_PHONE!, text: 'sdk-rc-smoke' });
  console.assert(msg.id);
}

// Cleanup
await client.instances.delete(created.id);
```

**Automation target (proposed):**

```bash
make release-validate-sdk
# bun run scripts/release/validate-sdk.ts
# Exits non-zero on any failure. Logs to docs/releases/sdk-validation-<date>.log.
```

**Why only three operations?** SDK validation is *type-level* first and *runtime-smoke* second. If types compile, the bulk of consumer safety is covered. Three runtime ops prove the client wiring end-to-end without duplicating the API smoke tests.

---

## 3. The Omni Toolkit — design document

> **Status:** DESIGN ONLY. Not yet implemented. This section defines the shape; implementation is a separate wish.

### 3.1 Motivation

The SDK is a 1:1 mirror of the REST API. That's correct for external integrations but wrong for **agentic usage** — when an LLM agent or automation script wants to drive Omni end-to-end, the SDK forces it to:

```typescript
// Today — agent wants "set up a WhatsApp instance with follow-up":
const inst = await sdk.instances.create({ name: 'x', channel: 'whatsapp' });
await sdk.instances.update(inst.id, { messageSplitDelayMinMs: 500, messageSplitDelayMaxMs: 2000 });
await sdk.followUp.set(inst.id, defaultFollowUpConfig);
await sdk.agents.attach(inst.id, agentId);
await sdk.instances.connect(inst.id);
await waitFor(() => sdk.instances.get(inst.id).then(i => i.isConnected), { timeout: 90_000 });
// 5 round-trips, 5 chances for partial state, 5 things to error-handle.
```

Agents repeatedly reimplement this orchestration. Each implementation is slightly wrong. The Toolkit exists to collapse compound operations into single calls with atomic error handling.

### 3.2 Principles

1. **Compound, not convenience.** The Toolkit is not "thin wrapper around one endpoint". It composes multiple SDK calls, handles partial-state rollback, and returns a single `Result`. If a single REST call is enough, use the SDK directly.
2. **Agentic-first API.** Optimized for LLM readability: self-documenting method names, typed error discriminants, side-effect-free dry-run modes where possible.
3. **Language-agnostic by design.** First implementation is TypeScript (same repo). Because the SDK targets REST, Python / Go / Rust Toolkits are ports, not reimplementations. REST is the contract.
4. **Not a replacement for the SDK.** Power users bypass the Toolkit when they need fine-grained control. The Toolkit is the *opinionated* layer.

### 3.3 Proposed surface area

```typescript
// packages/toolkit/src/index.ts
import { OmniClient } from '@omni/sdk';

export class OmniToolkit {
  constructor(private readonly client: OmniClient) {}

  /**
   * Set up a WhatsApp instance end-to-end: create, configure debounce + split-delay,
   * attach agent, configure follow-up, and optionally wait for QR-code connect.
   * Returns the instance + connection status. If any step fails, rolls back.
   */
  async setupInstance(config: {
    name: string;
    channel: 'whatsapp' | 'telegram' | 'discord' | 'slack' | 'gupshup';
    agentId?: string;
    debounce?: { minMs: number; maxMs: number };
    splitDelay?: { minMs: number; maxMs: number };
    followUp?: FollowUpConfig;
    waitForConnect?: { timeoutMs: number };
  }): Promise<SetupInstanceResult>;

  /**
   * Run a scripted conversation against an instance. Sends a sequence of messages
   * and awaits agent replies. Returns transcripts with timing and tool-call counts.
   * Useful for release-day dual-instance comparison.
   */
  async conversation(
    instanceId: string,
    messages: ScriptedMessage[],
    opts?: { toPhone: string; replyTimeoutMs?: number }
  ): Promise<ConversationTranscript>;

  /**
   * Run a QA scenario against an instance. Drives a deterministic conversation,
   * captures agent replies, and evaluates each reply against a rubric. Returns
   * pass/fail per turn plus aggregate score.
   */
  async qa(
    instanceId: string,
    scenario: QAScenario
  ): Promise<QAResult>;

  /**
   * Subscribe to instance events (messages, connection state, handoffs, follow-ups).
   * Yields events until the caller breaks the iterator.
   */
  async *monitor(
    instanceId: string,
    opts?: { types?: EventType[]; since?: Date }
  ): AsyncIterableIterator<OmniEvent>;

  /**
   * Compare two instances by driving identical input into both and returning
   * a structured diff of outputs, timing, and side effects. This is the
   * core primitive for release-day dual-instance comparison.
   */
  async compare(
    instanceA: string,
    instanceB: string,
    scenarios: QAScenario[]
  ): Promise<CompareReport>;
}
```

### 3.4 Example usage (agent pseudocode)

```typescript
// Full smoke test of release candidate:
const toolkit = new OmniToolkit(new OmniClient({ baseUrl: RC_URL, apiKey: KEY }));

const rc = await toolkit.setupInstance({
  name: 'release-smoke-rc',
  channel: 'whatsapp',
  agentId: KNOWN_AGENT,
  followUp: defaultFollowUpConfig,
  waitForConnect: { timeoutMs: 120_000 },
});

if (!rc.connected) throw new Error(`Connect failed: ${rc.error}`);

const conversation = await toolkit.conversation(rc.id, [
  { text: 'oi' },
  { waitMs: 2000 },
  { text: 'me fale sobre planos' },
], { toPhone: TEST_NUMBER, replyTimeoutMs: 30_000 });

console.log(conversation.summary());   // "2 turns, both replied, avg latency 1.2s"
```

### 3.5 Placement

Option A (**recommended**): `packages/toolkit/` inside the Omni monorepo.
- Pros: lives alongside SDK, shares versioning, monorepo tooling (turbo, biome) already wired.
- Cons: couples Toolkit releases to Omni releases. Mitigated by workspace-scoped publishing.

Option B: separate repo `automagik-dev/omni-toolkit`.
- Pros: independent release cadence, clearer separation of opinion-layer vs API-mirror.
- Cons: SDK version drift, duplicate CI, requires bumping the toolkit explicitly when the SDK adds new methods.

Decision pending. Recommended start: `packages/toolkit/` — prove the API shape, then extract if cadence genuinely diverges.

### 3.6 Non-goals

- Agent framework. The Toolkit does not run agents — it drives Omni. Agents live in agno / claude-code / openclaw.
- UI. The UI remains in `apps/ui/` and talks to the API directly.
- CLI replacement. The CLI is the operator tool. The Toolkit is the agent tool.

### 3.7 Open questions (for implementation wish)

1. How does `conversation()` correlate an outbound message with the agent's reply event? (Probably: subscribe to `message.received` filtered by `isAgentReply: true` within the reply-timeout window, matched by `replyTo` chain or `correlationId`.)
2. Does `qa()` require the agent to be deterministic (seeded)? Or do we accept LLM-judged rubric evaluation? (Recommended: accept both via `strategy: 'exact' | 'rubric'` param.)
3. Where do rubrics live? (Recommended: scenario YAML in `apps/qa-system/scenarios/` already exists — reuse it.)
4. Rate-limiting and backoff — does the Toolkit retry failed REST calls? (Recommended: yes, with exponential backoff for 5xx, not for 4xx.)

---

## 4. Release Day Runbook

### 4.1 Pre-flight (morning-of)

1. Read the most recent `docs/releases/v2-release-readiness-<date>.md`. Confirm:
   - All gates green or waived with explicit rationale.
   - No open `REGRESSION` verdicts from dual-instance comparison.
   - Migration plan reviewed if any breaking schema change.
2. Confirm rolling PR #393 is still green: `gh pr view 393 --repo automagik-dev/omni`.
3. Run `make release-validate-cli` and `make release-validate-api` against a pre-prod environment (dual-instance B). Zero failures required.
4. Announce in the internal channel: "release engineer proceeding with v<date> promotion."

### 4.2 Merge

- **Strategy: squash-merge.** Squash-merge collapses all dev commits into one conventional commit on main, which:
  - Bypasses per-commit commitlint failures (e.g., bot-authored "Update file.ts" commits).
  - Produces a clean commit graph on main.
  - Feeds release-please a single conventional-format commit to parse for CHANGELOG.
- Merge via GitHub UI: PR #393 → "Squash and merge" → title `chore(release): promote dev to main <date>` → confirm.
- **If squash-merge is not available** (repo policy override): rewrite any non-conventional commits on dev before merging. **Never** use `--no-verify` to bypass commitlint.

### 4.3 Post-merge automation

- `release-please` workflow fires on main push. It:
  - Bumps the repo version (currently date-based: `2.YYMMDD.N`).
  - Generates / updates `CHANGELOG.md` from conventional commits since the last release.
  - Tags the new release (e.g., `v2.260419.1`).
- Verify: `gh release view --repo automagik-dev/omni` shows the new tag.

### 4.4 Production deploy

1. SSH or `cd ~/prod/omni && git fetch origin && git checkout <new-tag>`.
2. `bun install --frozen-lockfile`.
3. `make build` (if applicable) or let the bundle rebuild on restart.
4. Expect `migrateDb()` to run automatically on startup — review the migration list (8 migrations 0018→0025 for the 2026-04-19 cut).
5. `pm2 restart omni-api`.
6. Watch `pm2 logs omni-api --lines 100` for:
   - `Applied migration 0018_supreme_puma ... 0025_panoramic_sinister_six`
   - `API listening on :8080`
   - No ERROR-level logs.

### 4.5 Post-deploy smoke tests

Run immediately after the API reports healthy:

```bash
# 1. Health
curl -fsS http://localhost:8080/health | jq

# 2. CLI smoke against production
omni instances list --json | jq 'length'
omni events list --since 2m --json | jq 'length'

# 3. Actually send a message through one connected instance (to a known test number)
omni send --instance <known-prod-instance-id> --to <test-number> --text "post-deploy smoke $(date -u +%Y%m%dT%H%M%SZ)"

# 4. Confirm the send completed and an outbound event was published
omni events list --since 1m --json | jq '.[] | select(.type == "message.sent")'
```

Zero errors in the last 5 minutes of logs. Test message delivered. Record results in `docs/releases/post-deploy-<date>.md`.

### 4.6 Rollback plan

**If a critical regression is observed within the first 2 hours of deploy:**

```bash
# A) Fast path — revert the merge commit on main (keeps db at new schema):
cd ~/prod/omni
git fetch origin
LAST_MERGE=$(git log --merges --format="%H" origin/main -1)
git revert -m 1 $LAST_MERGE
git push origin main
# Then release-please will cut a new patch tag; redeploy normally.

# B) Full path — roll production bundle back to previous tag:
PREV_TAG=$(git describe --tags --abbrev=0 <new-tag>^)
cd ~/prod/omni
git checkout $PREV_TAG
bun install --frozen-lockfile
pm2 restart omni-api
# NOTE: DB is still at the new schema. This is usually fine because migrations
# are additive (columns added, tables added). If the new code relies on a
# forward-incompatible column, rollback requires manual DB surgery — which is
# why additive-only migrations are the rule.
```

**Rollback for breaking DB changes (e.g., `0018_supreme_puma` Gupshup column rename):**

Column renames are *not* automatically reversible. If gupshup is broken after deploy:

1. Reverse the renames manually:
   ```sql
   ALTER TABLE instances RENAME COLUMN gupshup_event_id     TO gupshup_source_phone;
   ALTER TABLE instances RENAME COLUMN gupshup_auth_token   TO gupshup_app_name;
   ALTER TABLE instances RENAME COLUMN gupshup_callback_url TO gupshup_api_key;
   ```
2. Edit the journal: remove the `0018_supreme_puma` entry + snapshot.
3. Checkout previous tag and restart. Expect `migrateDb()` to run clean.

This is high-risk. **Prefer rolling forward with a fix** unless gupshup is business-critical. Document the decision.

---

## 5. Breaking Changes Communication

When a release contains a breaking change (schema rename, removed API, removed CLI flag, changed event payload), the release engineer writes an internal notice **before** merging, and pins it in the release channel.

### Template

```markdown
## Omni v<VERSION> — Breaking Change Notice

**Effective:** <UTC timestamp of planned deploy>
**Author:** <release engineer>

### What changed

<One paragraph: concrete change, with before/after snippets if relevant.>

Example for 2026-04-19:
> The `instances` table columns `gupshup_api_key`, `gupshup_app_name`, and
> `gupshup_source_phone` have been renamed to `gupshup_callback_url`,
> `gupshup_auth_token`, and `gupshup_event_id` respectively. The Gupshup
> plugin rewrite (PR #401) uses the new columns with different semantic
> meanings — the old values under the renamed columns are no longer valid
> connection configuration.

### Who is affected

- [ ] External API consumers
- [ ] CLI users
- [ ] SDK consumers
- [ ] Operators of Gupshup instances
- [ ] ...

### Migration steps

<Numbered list. Concrete commands or SQL. Zero-ambiguity steps.>

1. After `pm2 restart omni-api` completes and migrations 0018-0025 apply...
2. Run: `SELECT id, name, gupshup_callback_url, gupshup_auth_token, gupshup_event_id FROM instances WHERE channel = 'gupshup';`
3. For each row, re-run `omni instances update <id> --gupshup-callback-url <...> --gupshup-auth-token <...> --gupshup-event-id <...>` with the correct values.
4. Verify via `curl -X POST <gupshup-webhook-url>` that the instance accepts the new webhook format.

### Rollback option

<Describe the rollback path specific to this change. If rollback is non-trivial, say so.>

### Questions

Reply in thread. Release engineer on-call until end-of-day.
```

### Distribution

- Internal Slack: `#omni-releases` (or equivalent).
- Email digest: at-mention affected on-call / ops owners.
- In-repo: `docs/releases/breaking/<date>.md` committed alongside the readiness gate.

---

## 6. Proposed Makefile additions

The following targets are **proposed** (not yet in Makefile) to automate this process. Implementation is a separate wish.

```makefile
# Release-specific targets. Implementation TBD in a separate wish.

release-bootstrap-dual:   ## Bring up instance A (from ~/prod/omni, main) and B (from ~/dev/omni, dev) side-by-side
	bun scripts/release/bootstrap-dual.ts

release-teardown-dual:    ## Tear down A and B instances cleanly
	bun scripts/release/teardown-dual.ts

release-compare:          ## Run dual-instance comparison scenarios (2.1)
	bun scripts/release/compare.ts

release-validate-cli:     ## Run CLI validation matrix (2.2)
	bun scripts/release/validate-cli.ts

release-validate-api:     ## Run API smoke tests (2.3)
	bun scripts/release/validate-api.ts

release-validate-sdk:     ## Run SDK validation (2.4)
	bun scripts/release/validate-sdk.ts

release-gate:             ## Run the full readiness gate: all of the above + write the report
	@bun scripts/release/gate.ts

release-dry-run:          ## Full pipeline against a staging environment, no merge
	$(MAKE) release-bootstrap-dual
	$(MAKE) release-compare
	$(MAKE) release-validate-cli
	$(MAKE) release-validate-api
	$(MAKE) release-validate-sdk
	$(MAKE) release-teardown-dual
```

Each target produces a dated artifact under `docs/releases/` so the release is auditable after the fact.

---

## 7. Process improvements — open questions

1. **Squash-merge on rolling PRs** — should we enforce squash-only as a repo policy? Would prevent future commitlint failures on bot-authored commits (e.g., `4e91807f` on 2026-04-19). Proposal: yes, enforce at branch-protection level.
2. **Migration reversibility policy** — should we require every migration to ship with a reverse SQL script? Trade-off: slower development vs. safer rollback. Proposal: require for every migration that renames / drops. Additive migrations exempt.
3. **Dual-instance automation** — scripts/release/compare.ts is vaporware today. First implementation wish should produce at least the 5-scenario minimum from §2.1.
4. **Toolkit sequencing** — build Toolkit before or after release-process automation? Proposal: release-process first (Toolkit is v2+). Toolkit reuses release-process scripts for its `compare()` method.

---

*Process owner: whoever holds the release-engineer role. Propose changes via PR against dev.*
