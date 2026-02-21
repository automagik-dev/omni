# CI & Quality Setup Guide

> Reproduce Omni v2's full quality pipeline in a new repo.
> Runtime: Bun. Monorepo: Turborepo. All tools configured for zero-tolerance.

---

## 1. Foundation

### Package Manager & Runtime

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Init monorepo
mkdir my-project && cd my-project
bun init -y
```

**package.json** (root):
```json
{
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "test": "turbo test",
    "clean": "turbo clean && rm -rf node_modules",
    "prepare": "husky"
  },
  "packageManager": "bun@1.1.42",
  "engines": { "node": ">=20" }
}
```

### Dev Dependencies (root)

```bash
bun add -d @biomejs/biome@^1.9.4 \
  @commitlint/cli@^20.4.1 \
  @commitlint/config-conventional@^20.4.1 \
  husky@^9.1.7 \
  turbo@^2.3.3 \
  typescript@^5.7.3 \
  bun-types@^1.1.42
```

---

## 2. TypeScript

### Root tsconfig.json

Every package extends this. Strict mode, Bun-native.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "incremental": true,
    "types": ["bun-types"]
  },
  "exclude": ["node_modules", "dist", ".turbo"]
}
```

### Per-package tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Key flags:
- `noUncheckedIndexedAccess` — forces null checks on `obj[key]`
- `noImplicitOverride` — requires `override` keyword
- `verbatimModuleSyntax` — enforces `import type` for type-only imports
- `strict: true` — enables all strict checks

---

## 3. Biome (Linter + Formatter)

### biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": "error"
      },
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useConst": "error",
        "useImportType": "error"
      },
      "suspicious": {
        "noExplicitAny": "error",
        "noConsole": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "files": {
    "ignore": [
      "node_modules", "dist", ".turbo",
      "*.min.js", "bin", "*.generated.ts"
    ]
  },
  "overrides": [
    {
      "include": ["scripts/**"],
      "linter": {
        "rules": {
          "suspicious": { "noConsole": "off" },
          "complexity": { "noExcessiveCognitiveComplexity": "off" }
        }
      }
    }
  ]
}
```

### Zero-Tolerance Rules (NEVER downgrade to "warn")

| Rule | Level | Why |
|------|-------|-----|
| `noExcessiveCognitiveComplexity` | `error` | Forces function extraction, keeps code reviewable |
| `noNonNullAssertion` | `error` | Eliminates `!` operator — use proper null checks |
| `noExplicitAny` | `error` | Type everything or use `unknown` |
| `noConsole` | `error` | Use a logger (pino, winston). Override in `scripts/` only |
| `noUnusedImports` | `error` | Dead imports = confusion |
| `noUnusedVariables` | `error` | Dead code at the local level |
| `useImportType` | `error` | Enforced by `verbatimModuleSyntax` in TS too |

### When Complexity Blocks You

Extract sub-functions. Never suppress with `biome-ignore`:
```typescript
// BAD: biome-ignore complexity: too complex
function handleEverything() { ... }

// GOOD: extract
function validateInput(data: Input) { ... }
function transformData(validated: Valid) { ... }
function persistResult(transformed: Result) { ... }
function handleEverything() {
  const valid = validateInput(data);
  const transformed = transformData(valid);
  return persistResult(transformed);
}
```

### Auto-fix

```bash
bunx biome check --write .          # fix imports, formatting, useImportType
bunx biome check --error-on-warnings .  # CI mode (warnings = errors)
```

---

## 4. Turborepo

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build", "^typecheck"],
      "outputs": []
    },
    "lint": { "outputs": [] },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": { "cache": false }
  }
}
```

Key design:
- `typecheck` depends on `^build` — packages that emit `.d.ts` must build first
- `test` depends on `^build` — same reason (SDK types)
- `dev` is never cached (live reload)
- Turbo remote caching via `rharkor/caching-for-turbo` in CI

### Per-package scripts

Each `packages/*/package.json` should have:
```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "dev": "bun --watch src/index.ts"
  }
}
```

---

## 5. Husky (Git Hooks)

### Setup

```bash
bunx husky init
```

This creates `.husky/` and adds `"prepare": "husky"` to package.json.

### .husky/pre-commit

Runs biome lint before every commit. Fast (<1s).

```bash
make lint
```

### .husky/commit-msg

Validates conventional commit format.

```bash
bunx commitlint --edit "$1"
```

### .husky/pre-push

Runs full typecheck before push. Blocks pushes to main.

```bash
# Block pushes to main/master
remote="$1"
while read local_ref local_oid remote_ref remote_oid; do
  if echo "$remote_ref" | grep -qE 'refs/heads/(main|master)$'; then
    echo "BLOCKED: push to $remote_ref is forbidden."
    echo "Main is production — use PRs."
    exit 1
  fi
done

# Build SDK dist if missing (typecheck depends on .d.ts outputs)
if [ ! -d packages/sdk/dist ]; then
  echo "Building SDK (dist/ missing)..."
  cd packages/sdk && bun run build && cd ../..
fi

make typecheck
```

### Commitlint Config

**commitlint.config.ts**:
```typescript
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message: string) => message.startsWith('[skip ci]')],
};
```

Enforces: `type(scope): description` with max ~100 char header.

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`

---

## 6. Testing (Bun Test)

### How tests run

```bash
bun test --env-file=.env              # all tests
bun test packages/api/src             # package-specific
bun test path/to/file.test.ts         # single file
```

### Test file convention

```
packages/*/src/__tests__/*.test.ts
```

Tests use `bun:test` (built-in, no jest/vitest needed):
```typescript
import { describe, expect, it, beforeEach } from 'bun:test';

describe('MyFeature', () => {
  it('does the thing', () => {
    expect(result).toBe(expected);
  });
});
```

### CI test execution

Tests run as part of the quality gate after build + typecheck + lint.
Database and NATS are started in CI for integration tests.

---

## 7. Dead Code Detection (Knip)

### Three-Layer Quality Strategy

| Layer | Tool | What It Catches |
|-------|------|-----------------|
| File-level hygiene | Biome | Unused imports, unused variables, style, complexity |
| Type safety | TypeScript strict | Type errors, unresolved imports |
| Cross-package graph | Knip | Unused exports, dead files, dependency hygiene |

Biome and TypeScript analyze one file or one project at a time. Knip traces the **full monorepo import graph** to find dead code that crosses package boundaries.

### What Knip Catches (that nothing else does)

- **Unused exports** — functions/types exported but never imported anywhere
- **Dead files** — entire files that nothing imports
- **Unused dependencies** — packages in package.json nobody requires
- **Unused devDependencies** — dev deps not used by any script/config
- **Phantom dependencies** — using a package not in your package.json (hoisted from another workspace)
- **Unlisted binaries** — scripts calling binaries not declared as deps

### knip.json

```jsonc
{
  "$schema": "https://unpkg.com/knip@5.85.0/schema.json",
  "workspaces": {
    ".": {
      "entry": ["scripts/test-messaging.ts"],
      "project": ["scripts/**/*.ts"],
      "ignore": [
        "scripts/backfill-*.ts",
        "scripts/check-*.ts",
        "scripts/fix-*.ts",
        "scripts/find-*.ts",
        "scripts/compare-*.ts",
        "scripts/verify-*.ts",
        "scripts/redownload-*.ts",
        "scripts/test-pgboss.ts",
        "scripts/perf/**"
      ],
      "ignoreDependencies": ["@openapitools/openapi-generator-cli"]
    },
    "packages/api": {
      "project": ["src/**/*.ts"],
      "ignore": ["src/plugins/agent-responder.ts"]
    },
    "packages/core": { "project": ["src/**/*.ts"] },
    "packages/channel-sdk": { "project": ["src/**/*.ts"] },
    "packages/channel-discord": { "project": ["src/**/*.ts"] },
    "packages/channel-slack": { "project": ["src/**/*.ts"] },
    "packages/channel-telegram": { "project": ["src/**/*.ts"] },
    "packages/channel-whatsapp": { "project": ["src/**/*.ts"] },
    "packages/cli": {
      "entry": ["src/commands/*.ts"],  // CLI commands are entry points
      "project": ["src/**/*.ts"]
    },
    "packages/db": { "project": ["src/**/*.ts"] },
    "packages/media-processing": { "project": ["src/**/*.ts"] },
    "packages/plugin-openclaw": { "project": ["src/**/*.ts"] },
    "apps/ui": {
      "entry": [
        "src/pages/*.tsx",
        "src/components/ui/*.tsx",  // UI components are entries (consumed externally)
        "src/hooks/*.ts",
        "src/lib/*.ts",
        "src/types/*.ts"
      ],
      "project": ["src/**/*.{ts,tsx}"],
      "ignoreDependencies": ["tailwindcss"]  // tailwind is consumed by config, not imports
    }
  },
  "ignoreWorkspaces": [
    "packages/sdk",          // auto-generated, not hand-authored
    "packages/sdk-go",
    "packages/sdk-python",
    "packages/audio-decode-shim"
  ],
  "exclude": ["classMembers", "unresolved", "duplicates", "enumMembers"],
  "ignoreExportsUsedInFile": true  // don't flag exports that are also used locally
}
```

Key config decisions:
- `ignoreWorkspaces` — auto-generated SDK packages are excluded; knip can't reason about generated code
- `exclude: ["classMembers", ...]` — these categories produce too many false positives in plugin-heavy codebases
- `ignoreExportsUsedInFile` — a pattern like `export const X = ...; X()` in the same file is not dead
- `apps/ui` entry patterns — React components and hooks need explicit entry points since they're not imported via package index

### Running

```bash
bunx knip              # Full report
bunx knip --fix        # Auto-remove unused exports (use carefully)
make dead-code         # Same as bunx knip (Makefile target)
```

### Pipeline Placement

- **Pre-commit:** Not included (too slow, ~10-30s on monorepo)
- **CI:** Hard failure after lint, before test
- **Local:** `make dead-code` for developer convenience
- **`make check`:** Included in full quality pipeline: typecheck → lint → dead-code → test

### Zero-Tolerance Rules

| What | Policy | Why |
|------|--------|-----|
| Unused exports | Error | Dead API surface confuses consumers |
| Dead files | Error | Orphaned code bloats the repo |
| Unused dependencies | Error | Phantom deps cause install failures |

---

## 8. GitHub Actions CI

### ci.yml — Quality Gate

Triggers on push to `main`/`dev` and all PRs targeting them.

**Jobs:**

| Job | What | Timeout |
|-----|------|---------|
| `secrets-scan` | GitGuardian scans for leaked secrets | 5m |
| `quality-gate` | Build → Typecheck → Lint → Test | 15m |
| `smoke-test` | Full boot: start API, hit `/health`, verify | 15m |

**Quality Gate steps:**
1. Checkout + setup Bun
2. Turbo remote cache (via `rharkor/caching-for-turbo`)
3. Cache bun packages + NATS binary
4. `bun install`
5. Start pgserve + NATS (background)
6. Wait for database ready (drizzle push with retry)
7. `bun run build` (all packages)
8. Verify build outputs exist (`packages/sdk/dist`, `packages/cli/dist`)
9. `bun run typecheck` (turbo, all packages)
10. `bunx biome check .` (lint, all files)
11. `bunx knip` (dead code — unused exports, dead files, unused deps)
12. `bun test --env-file=.env` (all tests)

**Smoke Test steps:**
1. Same setup as quality gate
2. Build all packages
3. Start API server (background)
4. Poll `GET /health` until healthy
5. Verify response `{ "status": "healthy" }`
6. Verify single process on port (no ghost processes)

**Concurrency:** `ci-${{ github.ref }}` with `cancel-in-progress: true` — new pushes cancel stale runs.

### commitlint.yml

Separate workflow, uses `wagoid/commitlint-github-action@v6` to validate all commit messages in PRs.

```yaml
name: Commitlint
on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  commitlint:
    name: Commit Messages
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: wagoid/commitlint-github-action@v6
        with:
          configFile: commitlint.config.ts
```

### rolling-pr.yml — Dev → Main Promotion

Runs hourly. Creates/maintains a rolling PR from `dev` to `main`.

```yaml
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:
```

- Checks if open PR exists (dev → main)
- Creates one if missing
- Human reviews and merges when ready

### version.yml — Auto Version Bumping

Triggers after CI passes on `dev` (specifically on PR merges).

Version format: `2.YYYYMMDD.N` (date-based, N = build number for the day).

Steps:
1. Derive version from git tags
2. Run `generate-version.ts` → `version.json`
3. Run `sync-versions.ts` → updates all `package.json` versions
4. Format JSON with biome
5. Commit `[skip ci]` + tag + push to dev

### release.yml — Production Release

Triggers on push to `main` (after human merges rolling PR).

Steps:
1. Read version from `package.json`
2. Generate changelog with `git-cliff` (conventional commits → grouped notes)
3. Create GitHub release with changelog
4. Build CLI package
5. `bun publish --access public` to npm

---

## 9. Changelog (git-cliff)

### cliff.toml

Groups conventional commits into emoji categories:

| Prefix | Group |
|--------|-------|
| `feat` | 🚀 Features |
| `fix` | 🐛 Bug Fixes |
| `perf` | ⚡ Performance |
| `refactor` | ♻️ Refactoring |
| `test` | 🧪 Testing |
| `doc` | 📚 Documentation |
| `ci` | ⚙️ CI/CD |
| `chore` | 🔧 Miscellaneous |

Skips: `chore(version)` bumps, merge commits.

Adds contributor section with GitHub profile links.

---

## 10. Makefile (Developer UX)

Wraps all commands with proper env loading, dependency checks, and sequencing.

**Key targets:**

```makefile
# One-command setup
setup: check-deps install dev-services _init-db-wait _build-dist
	bun run dev

# Quality (what CI runs, locally)
check: typecheck lint dead-code test

typecheck: _build-dist
	bun run typecheck        # turbo typecheck across all packages

lint:
	bunx biome check .       # single biome invocation, whole repo

dead-code:
	bunx knip                # full monorepo graph: unused exports, dead files, unused deps

test: _build-dist _sync-db
	bun test --env-file=.env # bun test, loads env for DB/NATS

# Auto-fix
lint-fix:
	bunx biome check --write .
```

**Why Makefile over npm scripts:**
- Loads `.env` properly (`set -a && . ./.env`)
- Handles dependencies (build SDK before typecheck)
- Provides sequencing (start DB → wait → push schema → test)
- One command for everything (`make setup`)

---

## 11. Claude Code Hooks (AI Agent Safety)

For repos where AI agents commit code. These catch what git hooks can't.

### .claude/hooks/git-safety.sh

```bash
#!/bin/bash
set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

[ -z "$command" ] && exit 0
echo "$command" | grep -q 'git' || exit 0

# Block --no-verify (bypasses ALL git hooks)
if echo "$command" | grep -q '\-\-no-verify'; then
  cat >&2 <<'EOF'
BLOCKED: --no-verify is FORBIDDEN.
Fix the lint/type/commit-msg error, then commit normally.
EOF
  exit 2
fi

# Block bare --force (git hooks can't catch push flags)
if echo "$command" | grep -qE 'git\s+push\b' \
  && echo "$command" | grep -qE '(^|\s)--force($|\s)|(^|\s)-f($|\s)' \
  && ! echo "$command" | grep -q 'force-with-lease'; then
  cat >&2 <<'EOF'
BLOCKED: git push --force is FORBIDDEN.
Use --force-with-lease if rewriting history, or plain git push.
EOF
  exit 2
fi

exit 0
```

### .claude/settings.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/git-safety.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

---

## 12. Git Workflow

### Branch Strategy

```
main ←── rolling PR (human merges) ←── dev ←── feature PRs
                                         ↑
                                         └── direct commits (fixes)
```

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production | PR-only, all CI checks required |
| `dev` | Integration | Direct commits OK, PRs need checks |
| `feat/*` | Features | PR to dev, auto-merge when green |

### Concurrency

All CI workflows use concurrency groups to cancel stale runs:
```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

---

## 13. What's NOT Covered (Gaps)

### Other Gaps to Consider

| Gap | Tool | Notes |
|-----|------|-------|
| Dependency audit | `bun audit` (not yet available) | Use `npm audit` as fallback |
| License compliance | `license-checker` | Scan deps for GPL/AGPL |
| Bundle size tracking | `size-limit` | Prevent accidental bloat |
| API schema drift | OpenAPI diff | Detect breaking API changes |

---

## Quick Reproduction Checklist

```bash
# 1. Init
mkdir my-project && cd my-project
bun init -y

# 2. Install tooling
bun add -d @biomejs/biome typescript bun-types turbo \
  husky @commitlint/cli @commitlint/config-conventional

# 3. Create configs
# - tsconfig.json (strict, bun-types)
# - biome.json (zero-tolerance rules)
# - turbo.json (build → typecheck → test pipeline)
# - commitlint.config.ts (conventional commits)

# 4. Setup husky
bunx husky init
# Create: .husky/pre-commit (make lint)
# Create: .husky/commit-msg (bunx commitlint --edit "$1")
# Create: .husky/pre-push (make typecheck + block main push)

# 5. Create Makefile
# Targets: setup, dev, check, typecheck, lint, test, lint-fix

# 6. Create CI workflows
# - ci.yml (quality gate + smoke test + secrets scan)
# - commitlint.yml (commit message validation)
# - rolling-pr.yml (dev → main promotion)
# - version.yml (auto version on dev merge)
# - release.yml (changelog + npm publish on main push)

# 7. Add dead code detection
bun add -d knip
# Create knip.json (see Section 7 for full config)
# Add `dead-code: bunx knip` to Makefile and include in `check` target

# 8. Verify
make check  # typecheck + lint + dead-code + test — must be green
```
