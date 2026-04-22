# Wish: Fix Server Version Detection

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `fix-server-version` |
| **Date** | 2026-03-17 |

## Summary
The API server always reports version `2.0.0-dev.1` instead of the real version (e.g., `2.260317.2`). The CLI shows `(server: 2.0.0-dev.1 ↑ update available)` even when CLI and server are the same version. Root cause: `version-headers.ts` tries to find `package.json` via `import.meta.dir` relative paths that don't work in bundled/global npm installs.

## Scope

### IN
- Fix `packages/api/src/middleware/version-headers.ts` to detect version correctly in all environments (dev, bundled, global npm install)
- Use the same pattern as the CLI: import `package.json` at build time so the version is embedded in the bundle

### OUT
- Changing the CLI version detection (already works correctly)
- Adding `version.json` build step (overkill — direct import is simpler)
- Modifying PM2 config or env vars

## Decisions

| Decision | Rationale |
|----------|-----------|
| Import package.json at build time | CLI already does this (`import pkg from '../package.json'`). Consistent pattern. Works in all environments. |
| Keep fallback chain for dev mode | `loadRepoPackageVersion()` still useful when running unbundled in dev |

## Success Criteria
- [ ] `omni --version` shows matching CLI and server versions (no "update available" when same)
- [ ] API response header `x-omni-server-version` returns the real version (e.g., `2.260317.2`)
- [ ] `LAST_RESORT_VERSION` is never reached in normal operation

## Execution Groups

### Group 1: Fix Version Detection
**Goal:** Embed version from package.json at build time in the API server bundle.

**Deliverables:**
1. In `packages/api/src/middleware/version-headers.ts`:
   - Add `import pkg from '../../../package.json'` (or the correct relative path to root package.json)
   - Use `pkg.version` as the primary version source (like CLI does)
   - Keep existing fallback chain as secondary
2. Verify the build includes the version correctly

**Acceptance criteria:**
- Server responds with real version in `x-omni-server-version` header
- `omni --version` shows `2.260317.x (server: 2.260317.x ✓)` when matching

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -q "import.*package.json\|require.*package.json\|pkg.version\|EMBEDDED_VERSION" packages/api/src/middleware/version-headers.ts && \
echo "PASS"
```

**depends-on:** none

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bun bundler may not inline JSON imports | Low | CLI already uses this pattern successfully with Bun |
| Relative path to root package.json may differ in API package | Low | Check `import.meta.dir` vs package structure at build time |
