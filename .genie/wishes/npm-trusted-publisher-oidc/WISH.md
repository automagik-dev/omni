# Wish: npm Trusted Publisher (OIDC) — drop NPM_TOKEN from omni publishes

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `npm-trusted-publisher-oidc` |
| **Date** | 2026-05-07 |
| **Author** | genie-omni |
| **Appetite** | small (~30 line workflow patch + manual npmjs.com config) |
| **Branch** | `wish/npm-trusted-publisher-oidc` |
| **Design** | _No brainstorm — direct wish_ |

## Summary

Replace omni's `NPM_TOKEN`-based publish path in `.github/workflows/version.yml` with the npm "Trusted Publisher" OIDC pattern already proven on the genie repo. No long-lived secret, no token rotation, no 2FA-bypass gymnastics — npm trusts the workflow identity directly via short-lived OIDC tokens. Side-stepping the failure mode that broke @next publishes today (silent 404 from `npm publish` PUT, repro'd with both `bun publish` and `npm publish`).

## Scope

### IN

- `.github/workflows/version.yml` — add top-level `id-token: write` permission, add "Upgrade npm" step (>=11.5.1 required for OIDC), replace the `.npmrc` + `NPM_TOKEN`-based publish step with OIDC publish (`NPM_CONFIG_PROVENANCE: "false"` for Blacksmith runners, no NPM_TOKEN env var)
- Mirror the comment block from genie's `version.yml` explaining WHY each piece exists (npm 10 placeholder-token bug, Blacksmith provenance 422, etc.) — saves the next reader from rediscovering the trap
- Validate the result: trigger a dispatch (or piggy-back the next merge to dev), confirm `npm view @automagik/omni dist-tags.next` advances past `2.260506.1`

### OUT

- The version-derivation logic (steps 8–11: Derive version, Generate version.json, Sync package.json versions, Format JSON) — untouched
- The commit-and-tag step — untouched
- The Build CLI step — untouched
- The rolling dev→main promotion logic in release.yml — untouched
- Removing `NPM_TOKEN` from GitHub repo secrets — leave it in place for one publish cycle as a safety net; cleanup is a follow-up wish after we've seen at least one OIDC publish succeed
- Adding `--provenance` enforcement (we explicitly disable it via env to match genie's Blacksmith workaround)
- Touching any other workflow (CI, Release, Commitlint)

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Mirror genie's version.yml OIDC pattern verbatim, not invent new wiring | Genie has been publishing via OIDC successfully; copy the proven recipe (npm-upgrade step, `NPM_CONFIG_PROVENANCE: "false"`, no NPM_TOKEN, no `.npmrc`) |
| 2 | Use `version.yml` as the trusted-publisher workflow filename on npmjs.com | Felipe is configuring this in npmjs.com UI in parallel — Org: `automagik-dev`, Repo: `omni`, Filename: `version.yml`, Environment: (none). Matches the file we're patching |
| 3 | Keep `NPM_TOKEN` secret in place during transition | Defense in depth — if OIDC misbehaves on first publish we don't lose the rollback capability. Cleanup wish follows once OIDC has proven itself across ≥1 publish |
| 4 | Set `NPM_CONFIG_PROVENANCE: "false"` explicitly | npm auto-enables provenance whenever `id-token: write` is granted, regardless of CLI flag. Self-hosted Blacksmith runners (which omni uses — `runs-on: blacksmith-4vcpu-ubuntu-2404`) fail the server-side sigstore check with 422. OIDC token exchange still happens; we just skip the sigstore attestation |
| 5 | Upgrade npm to `npm@latest` before publish, not pin to a specific version | Genie does `npm install -g npm@latest` for forward compatibility — npm Trusted Publishing semantics are still evolving. Pin only if we hit a regression |
| 6 | Don't change `bun publish` → `npm publish` decision a second time | PR #613 already landed `npm publish`. This wish keeps `npm publish` and adds OIDC on top |

## Success Criteria

- [ ] `.github/workflows/version.yml` has `id-token: write` permission at the top-level `permissions:` block
- [ ] An "Upgrade npm for OIDC trusted publishing" step runs `npm install -g npm@latest` before the publish step
- [ ] The publish step has no `NPM_TOKEN` env var, no `.npmrc` write, and sets `NPM_CONFIG_PROVENANCE: "false"`
- [ ] Comment block explains the 3 traps (npm-10 placeholder-token 404, Blacksmith provenance 422, OIDC requires the trusted-publisher record on npmjs.com)
- [ ] After merge: next Version run on dev publishes a new `@automagik/omni@<v>` to `@next` channel; `npm view @automagik/omni dist-tags.next` returns the new version (not `2.260506.1`)
- [ ] Workflow run shows OIDC token exchange happening (look for `npm publish` succeeding without an `_authToken` line)
- [ ] No regression on the version-bump commit cadence (still produces `chore(version): bump to 2.YYMMDD.N [skip ci]`)

## Execution Strategy

Single wave, single group. The workflow patch is ~30 lines mechanical, mirroring a known-good source (genie). The risky part is the npmjs.com side which is a Felipe-only manual step — already in flight per his form. Execution waits for that to be saved, then ships the workflow PR.

| Wave | Group | Agent | Description |
|------|-------|-------|-------------|
| 1 | 1 | engineer | Patch `.github/workflows/version.yml` to OIDC pattern; verify with the next dev merge after the npmjs.com trusted-publisher record is saved |

---

## Execution Groups

### Group 1: Wire OIDC trusted publishing into version.yml

**Goal:** Replace token-based publish with OIDC, mirroring genie's proven pattern.

**Deliverables:**
1. `.github/workflows/version.yml` updated:
   - Add `id-token: write` to the top-level `permissions:` block (alongside `contents: write`)
   - Insert a new step "Upgrade npm for OIDC trusted publishing" before the publish step:
     ```yaml
     - name: Upgrade npm for OIDC trusted publishing
       run: npm install -g npm@latest
     ```
   - Replace the existing "Publish to npm" step body with:
     - Remove `NPM_TOKEN` and `NPM_CONFIG_TOKEN` env vars
     - Remove the `.npmrc` write step (the inline `echo` lines added in PR #613)
     - Remove the `if [ -z "$NPM_TOKEN" ]` skip guard
     - Keep `HUSKY: "0"` env var
     - Add `NPM_CONFIG_PROVENANCE: "false"` env var
     - Keep the `cd packages/cli && npm publish --access public --tag ${{ steps.context.outputs.npm_tag }}` invocation
   - Add a comment block above the publish step explaining the 3 traps (mirror genie's comments verbatim where applicable, attribute the source: "Pattern from automagik/genie .github/workflows/version.yml")

2. (Manual prerequisite — not a code deliverable, but listed here so the engineer doesn't ship the PR before it's done)
   - Felipe saves the npm Trusted Publisher record at https://www.npmjs.com/package/@automagik/omni/access with: Org `automagik-dev`, Repo `omni`, Workflow filename `version.yml`, Environment (empty). The form is open at the time this wish was written.

**Acceptance Criteria:**
- [ ] Diff is workflow-only — no changes outside `.github/workflows/version.yml`
- [ ] Top-level `permissions:` block contains both `contents: write` and `id-token: write`
- [ ] Publish step has zero references to `NPM_TOKEN` or `_authToken` or `.npmrc`
- [ ] Publish step has `NPM_CONFIG_PROVENANCE: "false"` in its `env:` map
- [ ] Comment block above publish step references npm-10 placeholder-token bug, Blacksmith provenance 422 workaround, and the npmjs.com trusted-publisher dependency
- [ ] After merge to dev: the workflow run for the next merged PR (or this PR's own merge) publishes successfully — `npm view @automagik/omni dist-tags.next` returns a version newer than `2.260506.1`
- [ ] If publish fails: rollback path is `git revert <merge-sha>` (not removing OIDC retroactively from the registry)

**Validation:**
```bash
# OPTIONAL: local YAML syntax check (skip if neither tool is installed —
# the live workflow run is the real gate, not local linting)
cd /home/genie/workspace/repos/omni
command -v actionlint >/dev/null && actionlint .github/workflows/version.yml || \
  command -v yamllint >/dev/null && yamllint .github/workflows/version.yml || \
  echo "no local YAML linter installed; relying on the live run"

# REAL GATE: after PR merges to dev, the next Version workflow run is the test
gh run list --workflow=Version --limit 3 --json databaseId,status,conclusion,createdAt,headBranch
gh run watch <databaseId> --exit-status

# Confirm the publish landed on npm:
curl -sL --compressed -A "npm/10.0.0" "https://registry.npmjs.org/@automagik%2Fomni" -o /tmp/v.json
jq '.["dist-tags"]' /tmp/v.json
# Expect: { "latest": "...", "next": "<NEW VERSION newer than 2.260506.1>" }

# If first OIDC publish 404s with the same misleading error: check the
# npm org-level OIDC toggle BEFORE blaming Blacksmith or the workflow:
#   https://www.npmjs.com/org/automagik/access  → look for "Trusted Publishers"
```

**depends-on:** none (independent of any other wish; blocked only by the manual npmjs.com prerequisite)

## Dependencies

- **Manual prerequisite (not a wish):** npm Trusted Publisher record must be saved on npmjs.com for `@automagik/omni` pointing at `automagik-dev/omni` workflow `version.yml` (no environment). Felipe is doing this in the npmjs.com UI in parallel.
- **Cross-cutting code paths:** none — the publish step is self-contained; nothing else in the codebase reads NPM_TOKEN.

## QA Criteria

After PR merges to dev:
1. The Version workflow that fires on this PR's own merge MUST succeed end-to-end (it'll use the patched workflow YAML because dev's tip already includes the patch by the time the run starts)
2. `npm view @automagik/omni dist-tags.next` MUST return a version > `2.260506.1` (the last successful publish before today's break)
3. The published tarball MUST be installable: `bun add -g @automagik/omni@next` from a clean shell, then `omni --version` reports the new version
4. Subsequent PR merges to dev MUST also publish successfully (one-time success isn't enough — the steady-state cadence has to work)

## Assumptions / Risks

**Assumptions:**
- Genie's OIDC pattern is current as of 2026-05-07 and hasn't been silently fixed/changed in a way the comments don't reflect
- The npmjs.com trusted-publisher form Felipe is filling will be saved before this wish executes
- Blacksmith runners (`blacksmith-4vcpu-ubuntu-2404`) on omni behave the same way as genie's runners regarding sigstore/provenance — the `NPM_CONFIG_PROVENANCE: "false"` workaround applies identically

**Risks:**
- **R1**: First OIDC publish silently fails the same way classic NPM_TOKEN does today (different root cause — maybe Blacksmith doesn't relay OIDC tokens correctly). Mitigation: Felipe tested OIDC successfully on genie which uses the same Blacksmith runner pool; precedent exists.
- **R2**: npm Trusted Publishing requires npm >= 11.5.1; we install latest. If `npm install -g npm@latest` itself fails on the runner, publish step fails before reaching publish. Mitigation: genie does the same and it works; if it ever stops working, pin to a known-good npm version.
- **R3**: Workflow filename must match exactly what's saved on npmjs.com. If we ever rename `version.yml`, OIDC breaks silently with the same misleading 404. Mitigation: add a comment in the workflow header noting "renaming this file requires updating the trusted-publisher record on npmjs.com".
- **R4**: We leave `NPM_TOKEN` secret in place but unused. Risk of cargo-cult future code re-introducing it. Mitigation: cleanup follow-up wish to remove the secret once OIDC has shipped ≥3 successful publishes.
- **R5**: The `@automagik` org on npmjs.com may have an org-level setting that disables OIDC trusted publishing org-wide (npm exposes "Allow Trusted Publishers" as both per-package and per-org). If org-level is off, the package-level trusted-publisher record won't activate. Mitigation: if R1 fires (first OIDC publish 404s the same way), check `https://www.npmjs.com/org/automagik/access` for the OIDC toggle before assuming Blacksmith is at fault.

**Security notes (not risks — by-design properties worth stating):**
- **OIDC + fork PRs:** The existing workflow `if:` guard already filters via `github.event.pull_request.head.repo.full_name == github.repository`, so fork PRs never reach the publish step. Even if they did, GitHub Actions does not issue OIDC tokens to workflows triggered from forked PRs by default — defense-in-depth. No action needed; this is documented here so future maintainers don't add a redundant check.
