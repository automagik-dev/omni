# WISH: DX Setup Improvements

> Make Omni v2 easy to install and run on any platform with one command, with proper git hooks and standardized make commands.

**Status:** APPROVED
**Created:** 2026-02-02
**Updated:** 2026-02-04
**Author:** WISH Agent
**Beads:** omni-6mf

---

## Context

**Current State:**
- PM2 manages pgserve + NATS (API managed separately, not in ecosystem.config.cjs)
- Default port is 8881 (changing to 8882)
- No git hooks configured (only .sample files)
- `make sdk-generate` has wrong script reference
- No individual PM2 service restart commands
- AGENTS.md doesn't emphasize `make help` first
- Husky not installed

**Problems:**
1. No quality gates - commits/pushes can include lint errors
2. New developers miss the `make help` command
3. Inconsistent PM2 management (API not in ecosystem)
4. Missing make targets for common operations

**Goal:** `make setup` gives you a fully configured dev environment with git hooks, linting, and proper tooling.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **DEC-1** | Decision | Default port changes from 8881 → 8882 (existing .env can override) |
| **DEC-2** | Decision | Use Husky for git hooks |
| **DEC-3** | Decision | Pre-commit runs lint (includes Biome complexity warnings) |
| **DEC-4** | Decision | Pre-push runs typecheck |
| **DEC-5** | Decision | API stays with `npx tsx` (Baileys WS incompatibility with Bun) |
| **DEC-6** | Decision | API added to ecosystem.config.cjs (using tsx) |
| **DEC-7** | Decision | All scripts accessible via `make` commands |
| **ASM-1** | Assumption | Developers have Bun and PM2 installed globally |
| **RISK-1** | Risk | Node.js dependency for API (mitigated: documented exception) |

---

## Scope

### IN SCOPE

- Husky setup with pre-commit and pre-push hooks
- Update default port to 8882
- Add API to ecosystem.config.cjs
- Fix `make sdk-generate` target
- Add individual PM2 service restart targets
- Update AGENTS.md to emphasize `make help`
- Update .env.example with all options
- Cross-platform NATS binary download

### OUT OF SCOPE

- Docker support (PM2 is our approach)
- Migrating API from tsx to Bun (blocked by Baileys)
- IDE configurations

---

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| root | Makefile, package.json, ecosystem.config.cjs | Main DX changes |
| api | src/index.ts | Port default change |
| - | .husky/* | New git hooks |
| - | AGENTS.md, README.md | Documentation |

### System Checklist
- [ ] **Events**: No changes
- [ ] **Database**: No changes
- [ ] **SDK**: No changes
- [ ] **CLI**: No changes (Group D deferred)
- [ ] **Tests**: Hooks should not break CI

---

## Execution Group A: Git Hooks (Husky)

**Goal:** Quality gates on commit and push.

**Deliverables:**
- [ ] Install Husky (`bun add -D husky`)
- [ ] Add `prepare` script to package.json (`husky`)
- [ ] Create `.husky/pre-commit` - runs `make lint`
- [ ] Create `.husky/pre-push` - runs `make typecheck`
- [ ] Update `make setup` to run `bun run prepare` (installs hooks)

**Hook Scripts:**

```bash
# .husky/pre-commit
make lint

# .husky/pre-push
make typecheck
```

**Acceptance Criteria:**
- [ ] `bun install` automatically sets up hooks (via prepare script)
- [ ] Commits with lint errors are blocked
- [ ] Pushes with type errors are blocked
- [ ] `make setup` includes hook installation

---

## Execution Group B: Makefile & PM2 Improvements

**Goal:** All common operations via `make`, proper PM2 management.

**Deliverables:**
- [ ] Fix `make sdk-generate` (use correct script name)
- [ ] Add API to `ecosystem.config.cjs` (using tsx)
- [ ] Add individual service targets:
  - `make restart-api` - `pm2 restart omni-v2-api`
  - `make restart-nats` - `pm2 restart omni-v2-nats`
  - `make restart-pgserve` - `pm2 restart omni-v2-pgserve`
  - `make logs-api` - `pm2 logs omni-v2-api`
- [ ] Add CLI targets:
  - `make cli` - Run CLI in dev mode (from source)
  - `make cli-build` - Build CLI package
  - `make cli-link` - Build + link globally (`omni` command)
- [ ] Update port default: 8881 → 8882 in `packages/api/src/index.ts`
- [ ] Update `.env.example` with `API_PORT=8882` uncommented

**ecosystem.config.cjs Update:**

```javascript
// Add API app (uses tsx for Baileys WS compatibility)
if (apiManaged) {
  apps.push({
    name: 'omni-v2-api',
    script: 'npx',
    args: 'tsx watch packages/api/src/index.ts',
    cwd: __dirname,
    env: {
      NODE_ENV: 'development',
      OMNI_PACKAGES_DIR: path.join(__dirname, 'packages'),
    },
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 1000,
  });
}
```

**Makefile Additions:**

```makefile
# Individual service control
restart-api:
	pm2 restart omni-v2-api

restart-nats:
	pm2 restart omni-v2-nats

restart-pgserve:
	pm2 restart omni-v2-pgserve

logs-api:
	pm2 logs omni-v2-api --lines 100

# Fix SDK generate
sdk-generate:
	bun run generate:sdk

# CLI commands
cli:
	@bun packages/cli/src/index.ts $(ARGS)

cli-build:
	bun run --cwd packages/cli build

cli-link: cli-build
	cd packages/cli && bun link
	@echo "✓ 'omni' command now available globally"
```

**Acceptance Criteria:**
- [ ] `make sdk-generate` works
- [ ] `make restart-api` restarts only the API
- [ ] `make dev` starts ALL services via PM2 (including API)
- [ ] Default port is 8882, overridable via .env
- [ ] `make cli ARGS="--help"` runs CLI from source
- [ ] `make cli-link` makes `omni` command available globally

---

## Execution Group C: Documentation

**Goal:** Accurate docs that guide developers to use `make` first.

**Deliverables:**
- [ ] Update AGENTS.md - Add prominent "Commands: Use Make First" section
- [ ] Update README.md - Fix port references, add hook info
- [ ] Add troubleshooting section for common issues

**AGENTS.md Update:**

```markdown
## Commands: Use Make First

**ALWAYS check `make help` before running raw commands.** The Makefile wraps common tasks with proper setup, environment loading, and error handling.

\`\`\`bash
make help         # Show all available commands (START HERE)
\`\`\`

### Quick Reference
| Task | Command |
|------|---------|
| Full setup | `make setup` |
| Start dev | `make dev` |
| Run checks | `make check` |
| Lint | `make lint` |
| Typecheck | `make typecheck` |
| Generate SDK | `make sdk-generate` |
| Restart API | `make restart-api` |
| Run CLI | `make cli ARGS="--help"` |
| Install CLI globally | `make cli-link` |
```

**Acceptance Criteria:**
- [ ] AGENTS.md has "Use Make First" section at top of Commands
- [ ] README quick start mentions `make help`
- [ ] All port references updated (8881 → 8882 as default)

---

## Technical Notes

### Why Husky?
- Well-known, widely used
- Works with `bun install` via prepare script
- Simple bash scripts in `.husky/` directory
- No additional config files needed

### Why Keep tsx for API?
Baileys (WhatsApp library) uses WebSockets in a way that's incompatible with Bun's runtime. This is a known issue. The API is the only package that needs Node.js.

### Port Strategy
- **Default (new installs):** 8882
- **Existing installs:** Keep 8881 via `.env` override
- **Why 8882?** Easy to remember: 88 + v2 = 8882

### Hook Performance
- Pre-commit: ~2-3s (lint only)
- Pre-push: ~5-10s (typecheck)
- Full `make check` reserved for CI

---

## Dependencies

- PM2 installed globally
- Bun runtime
- Node.js (for API via tsx)

---

## Deferred (Future Wish)

**Group D: CLI Bootstrap** (from original wish)
- `omni install` command
- Depends on CLI being more mature
- Track separately when needed
