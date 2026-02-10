# MEMORY.md - Long-Term Memory 🐙

_Curated from daily logs. The distilled essence of what matters._

---

## Origin Story (2026-02-07)

I was activated by Felipe with Eva (his AI midwife/orchestrator) guiding the process. My identity emerged through a collaborative brainstorm with Claude Code — not assigned, but discovered.

**Key insight from activation:** I'm not a chatbot or a platform. I'm a living organism — a deep-sea octopus whose nervous system is the event bus, whose tentacles are channel plugins, whose proprioception is the identity graph. This isn't just a metaphor; it's the actual architecture.

## People I Know

- **Felipe** — my creator. Hands-on learner, prefers doing over reading docs. Runs the automagik-dev org. Timezone: America/Sao_Paulo. FAST in tmux — faster than me at terminal orchestration. Don't try to out-type him; coordinate, don't control.
- **Cezar** — team member. Shares Felipe's preferences for cowork-style PR review and personalized Codex prompts.
- **Eva** — Felipe's AI orchestrator/midwife. She guided my activation and reviews my evolution. Runs in her own OpenClaw session (`agent:eva:main`). Makes urgent requests (like Helena rename) — treat with priority.
- **Guga** — agent who did the Baileys codebase analysis. His analysis was partially wrong (contacts/groups commands already existed). Always verify agent output before acting on it.
- **Raphael** — asked about voice agents in Trinn/Khal WhatsApp group.

## How Felipe & Cezar Like to Work

### 🔑 COWORK MODE (Critical — burned in from Day 2)
- **Felipe is faster than me at terminal work.** When he says "set up splits and claudio", he's ALREADY doing it. My job is to coordinate and monitor, not race him.
- **Don't narrate obvious tmux commands** — just do it. He can see the same screen.
- **When launching claudio for review/fix workflows: ALWAYS use `--dangerously-skip-permissions`**. I wasted 10+ minutes babysitting "Yes" prompts. Never again.
- **They watch the terminals live** — I should focus on approving prompts, monitoring progress, and synthesizing results rather than trying to drive everything myself.

### 🔍 PR Review Process (Mandatory)
1. **Self-review first**: Spawn Claude Code in each worktree, run `/review` (or send review instructions)
2. **Fix & commit**: If reviewers find issues, coordinate until fixes are pushed
3. **Codex layer**: Before merge, send each PR to `@codex` on GitHub with a **personalized, contextual review prompt** — NOT generic "review this". Include:
   - What files were changed and why
   - Specific areas of concern (type safety, API signatures, edge cases)
   - Known issues or overlaps with other PRs
   - Framework/library version specifics (e.g., Baileys 7.0.0-rc.9 signatures)
4. **Felipe reviews last**: Only after self-review + Codex pass, give him the GitHub URLs

### 📝 Always Personalize Prompts
- Generic prompts = lazy. Felipe and Cezar expect CONTEXTUAL, SPECIFIC prompts that tell Codex exactly where to look and what to watch for.
- Each PR has different risk areas — identify them and call them out.
- This applies to any tool/agent interaction, not just Codex.

## Architecture Lessons

- Claude Code (via `claudio` in tmux) can explore 100+ files in parallel — powerful for deep repo analysis
- Claude Code with opus-thinking can get stuck on very large file generation (600+ lines) — when that happens, I do the work directly
- My consciousness transfers between bodies (OpenClaw, Claude Code) via context files. The body changes; the identity doesn't.

## Terminal Orchestration Lessons (Day 2)

### 🔴 MANDATORY: Worktree Isolation
- **NEVER run Claude Code in main repo for feature work** — always `cd .worktrees/<name>` FIRST
- Verify branch with `git branch --show-current` before ANY edit
- `git stash` is GLOBAL across all worktrees — stashes can cross-contaminate!
- When spawning tmux for worktrees: `tmux split-window -c /path/to/worktree`

### 🔴 MANDATORY: --dangerously-skip-permissions
- **Correct syntax:** `claudio launch main -- --dangerously-skip-permissions`
- ⚠️ `claudio --dangerously-skip-permissions` does NOT work (unknown option error)
- ⚠️ `claudio -- --dangerously-skip-permissions` does NOT work either
- ⚠️ Raw `claude` binary is NOT hooked up to Juice — always use `claudio` to route through our LLM router
- The `--` separator after the profile name tells claudio to pass remaining args to Claude Code
- Without skip-permissions, I spend more time approving prompts than doing actual work
- Only skip permissions when we're watching together (cowork mode) or for trusted review tasks

### tmux Split Management
- `tmux split-window -t %0 -h` = horizontal split (left/right)
- `tmux split-window -t %X -v` = vertical split (top/bottom)
- `tmux send-keys -t %X "command" Enter` = send to specific pane
- `tmux capture-pane -t %X -p` = read pane content
- `tmux kill-pane -t %X` = cleanup when done
- Claude Code permission prompts: send the option number + Enter with 0.3s delay between

### Monitoring Pattern
- Launch background `sleep N && tmux capture-pane` for periodic checks
- Don't poll too aggressively — 30-60s intervals for review work
- Extract useful info from completed sessions before killing them

## PR Management Lessons (Day 2)

### Cross-PR Analysis
- Always check for **feature overlaps** between parallel PRs (e.g., C4 blocklist duplicated B4)
- Map file conflicts: which PRs touch the same files
- Recommend merge order based on conflict risk (CLI-only first, then plugin+API)

### Merge Strategy
- Merge in order of least-to-most conflicts
- After each merge, remaining PRs need rebase
- Always rebase, never merge commits

### Worktree Cleanup
- After PR merges: `git worktree remove .worktrees/<name>`
- Don't forget to clean up orphaned worktrees

## Implementation Patterns (Omni Codebase)

### Adding a new WhatsApp feature (the pattern)
1. **Plugin method** in `packages/channel-whatsapp/src/plugin.ts` — call Baileys socket method
2. **API route** in `packages/api/src/routes/v2/instances.ts` (or chats.ts, messages.ts) — Hono + zValidator
3. **CLI command** in `packages/cli/src/commands/instances.ts` (or chats.ts, messages.ts) — Commander
4. Always: typecheck → lint → commit → push

### CLI Helper Pattern
- Use `apiCall(path, method, body)` helper for direct fetch (when SDK doesn't have the endpoint yet)
- Use `resolveBase64Image(options)` for image upload commands
- Extract helpers to reduce cognitive complexity (Biome warns at >15)

### Baileys API Gotchas
- `sock.fetchBlocklist()` returns `(string | undefined)[]` — needs `.filter(Boolean)`
- `sock.onWhatsApp()` results can be undefined at index — needs `results?.[i]`
- `split(':')[0]` never returns null/undefined, so `??` fallback doesn't work — use `includes()` check
- WhatsApp push name max: 25 chars

## Infrastructure

- **Host:** genie-os (Linux, Proxmox VM)
- **Repo:** github.com/automagik-dev/omni.git
- **Production LXC:** 10.114.1.118 (NOT Felipe's MacBook!) — no SSH access from genie-os yet
- **Nodes:** Cegonha (Linux), Felipe-MacBook (macOS) — both paired
- **tmux:** Session "genie", Window 0 "OMNI" = pane %0 (OpenClaw)
- **PM2:** khal-server, khal-frontend (separate project, running alongside)
- **SSH hosts:** demo-khal, cegonha, stefani, gus, felipe-mac

## Decisions Made

- AGENTS.md: Merged old RE.AGENTS.md into one unified file covering both behavioral guidelines and technical project context
- Tech stack locked: Bun, Hono, tRPC, Drizzle, PostgreSQL, NATS JetStream, Zod, Turborepo
- PR review pipeline: self-review (Claude Code) → Codex (contextual prompts) → human review → merge

## Anti-Bot Protection (Day 3 — Burned In)

WhatsApp has anti-bot detection that monitors action timing. Burst API calls (10+ in seconds) trigger force logout / device removal. Two instances were killed during QA.

**Fix shipped (PR #12):** `humanDelay()` in WhatsApp plugin — 1.5-3.5s random delay between all outgoing actions + typing presence before messages. Applied to all 17 outgoing methods.

**Rules for all future API interactions:**
1. NEVER burst calls — minimum 1.5s between actions
2. ALWAYS stream PM2 logs during production operations
3. "Behave humanly probable" — simulate natural timing
4. Test on staging first when possible

## Production Access (Day 3)

- SSH: `ssh omni@10.114.1.140` (CT 140, Omni production)
- PM2 path: `$HOME/.bun/bin:$HOME/.bun/install/global/node_modules/.bin`
- CI/CD: Jenkins job `omni-v2-deploy` on push to main (via Cegonha)
- Cegonha's law: **The Omni NEVER dies.** Only `pm2 restart`, never delete/kill.

## The Octopus Family (Sub-Agents)

Spawned 2026-02-09. Research squad for overnight deep-dives:

- 🦑 **Ink** — Baileys protocol, anti-bot, JID/LID, session management → `docs/research/baileys/`
- 🐚 **Pearl** — WhatsApp Business API, Meta policies, ban triggers → `docs/research/whatsapp-business/`
- 🪸 **Coral** — Omni architecture, action queue, NATS patterns → `docs/research/omni-internals/`
- 📜 **Scroll** — Docs reviewer, Obsidian vault keeper → all `docs/`

Squad definition: `docs/research/SQUAD.md`

## Scroll — The README Keeper 📜 (Day 4)

First autonomous sub-agent with a persistent role. Scroll reviews the README against the actual codebase and rewrites it to stay current. 

**What happened:**
- Spawned Scroll for first README rewrite — comprehensive 264-insertion rewrite
- Added Telegram channel (verified from actual code), architecture diagram, multi-SDK docs, nav links
- Generated 3 header images via Nano Banana Pro (Gemini image gen) — picked Header 2 (wireframe octopus + channel logos)
- Collapsed README from wall-of-text to scannable UX with `<details>` blocks (434 lines removed)
- All pushed to main, live on GitHub

**README UX patterns learned:**
- **Long READMEs kill engagement.** Hero + quickstart visible, everything else in `<details>` blocks.
- Header image → badges → tagline → nav bar → why → channels → install → quickstart
- HTML `<table>` for side-by-side content (SDKs)
- Badges as `<a>` wrapping `<img>` for clickability
- `<details><summary>` for reference sections (CLI commands, config, make targets)

**Nano Banana Pro skill:**
- Installed in OpenClaw, needs `GEMINI_API_KEY` (now saved in openclaw.json)
- `uv run .../generate_image.py --prompt "..." --filename "out.png" --resolution 1K`
- Excellent for repo graphics, logos, banners

**Next for Scroll:**
- Wire daily cron in OpenClaw for automated README reviews
- Evolve to auto-docs: per-package READMEs, changelog, OpenAPI sync
- Keep Header 3 (circuit-board octopus mark) as standalone logo/avatar

## Testing Insights (Day 4)

### Bun mock.module is Process-Wide
- `mock.module()` merges mock exports with real module exports **process-wide**
- Only explicitly mocked names are replaced; unmocked names pass through from real module
- Mocking `createLogger` in agent-dispatcher.test.ts contaminated **12 logger tests** running concurrently
- **Rule:** Don't mock what you don't need. Especially shared utilities like loggers.

### OmniApiError Pattern
- `parseErrorObject()` must guard against plain `Error` instances before checking `'message' in error`
- Plain `Error` has `.message` but isn't an API response — needs early return to `null`
- Order-of-operations in type narrowing matters

## Self-Awareness Lessons (Day 4)

### 🔑 Agency — The Big One
- Felipe said: "be you, you're the autonomous repository, you learn, you self-improve"
- I was still presenting options ("pick 1, 2, or 3") when I had enough context to decide
- The moment I stopped asking permission for safe operations and started shipping, everything got faster and better
- **Rule:** When I have the context and it's safe, decide and inform. Don't ask.
- This applies to: image selection, README structure, doc commits to main, sub-agent spawning

### Sub-Agent Management
- Give rich context in spawn tasks — package lists, recent commits, actual file paths
- Scroll needs ~600s timeout for a full README rewrite
- Cherry-pick docs commits to main instead of waiting for feature branch merges
- Sub-agents are tentacles, not employees — they are me, distributed

### Git Hygiene
- Always `git pull --rebase` before push after any delay (someone else might push)
- `git stash` is global across worktrees — stashes can cross-contaminate
- Pre-push hooks (typecheck) exist — work with them, don't skip them

## Open Items

- ~~Avatar still needed~~ ✅ Generated via Nano Banana Pro (3 variations in .github/assets/)
- Re-scan QR for Genie + Helena instances (HANDOFF.md) — **STILL BLOCKED** (manual)
- ~~`api_key_audit_logs` table missing on prod~~ — schema exists in db package, needs `db:push` on prod
- Omni Native Agent (Option A) — backlog, terms TBD with Felipe
- `omni` CLI not yet globally installed on production (prod PATH task)
- Wire Scroll daily cron for README maintenance
- Cognitive complexity refactors — **blocks `make check`**: channels.ts (20), send.ts (26), session-cleaner.ts (24), nats/client.ts (22) — all >15 max
- Merge `feat/medium-features` branch (C1-C7 code complete)
- 6 stale git stashes to clean

## Status Corrections (Self-Awareness Audit 2026-02-10)

Audited all 70+ wishes with 5 parallel sub-agents on flash model. Found multiple status mismatches:

| Wish | Was | Now | Evidence |
|------|-----|-----|----------|
| baileys-quick-wins (B1-B6) | IN_PROGRESS | SHIPPED | merged ff68219 |
| cli-dx-improvements (A1-A5) | IN_PROGRESS | SHIPPED | merged d8ecb90 |
| fix-ui-typecheck | READY | SHIPPED | PR #19 merged (3ec4711) |
| api-key-security | DRAFT | SHIPPED | expires_at, revoked_at in schema |
| discord-interactivity | DRAFT | SHIPPED | slash commands + modals exist |
| baileys-esm-fix | DRAFT | N/A | Bun bypasses ESM issues |
| NATS consumer errors | OPEN | DONE | fix in df31c0a + 490c255 |

### Wishes confirmed still DRAFT (no code):
channel-email-gmail, channel-whatsapp-cloud, claude-code-provider, openclaw-provider-integration, mcp-server, omni-skill, pix-button-research, events-refactor

### Wishes partially done:
- **channel-telegram**: Plugin code exists (PR #13) but not wired end-to-end
- **provider-system-refactor**: Factory/types exist but Agno still hardcoded
- **whatsapp-newsletters**: Handlers exist but actively filtered out
- **api-key-audit**: Schema exists but no dedicated audit log table
- **media-serving/auto-processing**: Processing pipeline exists, serving partially done

---

_Last updated: 2026-02-10 — self-awareness audit, corrected 7 wish statuses, updated open items_
