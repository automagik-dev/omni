# Wish: Public Repo Secret Leak Cleanup + Git History Rewrite

**Status:** DRAFT
**Beads:** omni-8j6
**Slug:** `git-history-secret-cleanup`
**Created:** 2026-02-11
**Requested by:** Felipe

---

## Summary

Purge leaked operational secrets and sensitive context from the public `automagik-dev/omni` repository history, then harden the workflow to prevent recurrence.

This includes removing sensitive files/content from all refs (`main`, `dev`, feature branches, tags), rotating leaked credentials, validating cleaned history, and publishing a safe collaborator migration procedure.

---

## Scope

### IN
- Remove sensitive files/content from full git history (not only HEAD)
- Revoke/rotate known leaked credentials before/alongside rewrite
- Rewrite and force-push all affected branches/tags
- Validate absence of known leaked tokens/patterns post-rewrite
- Add prevention guardrails (ignore rules + secret scanning)

### OUT
- Rewriting unrelated large binaries/history for repo size optimization
- Refactoring application code unrelated to secret exposure
- Rotating credentials not present in leak set

---

## Decisions

- **DEC-1:** Use `git filter-repo` (recommended successor to `filter-branch`) as canonical rewrite tool.
- **DEC-2:** Execute rewrite in a **fresh mirror clone** to minimize operator error.
- **DEC-3:** Revoke/rotate leaked keys as mandatory first-class task; history rewrite alone is insufficient.
- **DEC-4:** Treat `HANDOFF.md`, `MEMORY.md`, `TOOLS.md`, and `memory/` as sensitive; remove from public history and keep operational memory private.
- **DEC-5:** Coordinate a controlled force-push window with clear re-clone instructions for collaborators.

---

## Risks & Mitigations

- **Risk:** Breaking collaborators’ local clones after force-push
  - **Mitigation:** Publish explicit migration: fresh clone preferred; hard reset fallback documented.
- **Risk:** Missing one leaked token/string variant
  - **Mitigation:** Multi-pass scanning: exact key list + pattern-based scan + targeted file checks.
- **Risk:** Accidental loss of legitimate history
  - **Mitigation:** Pre-rewrite mirror backup bundle + rollback ref/tag.
- **Risk:** Re-leak after cleanup
  - **Mitigation:** Add `.gitignore` policy + pre-commit/CI secret scan gates.

---

## Success Criteria

- [ ] All known leaked API keys and gateway tokens are revoked/rotated.
- [ ] `HANDOFF.md` and other sensitive operational files are absent from rewritten public history.
- [ ] Post-rewrite scans return no matches for known leaked secret values.
- [ ] `main` and `dev` rewritten successfully and pushed.
- [ ] Collaborator migration instructions published and verified.
- [ ] Preventive secret scanning is enforced in CI (and ideally pre-commit).

---

## Execution Groups

### Group A — Incident Freeze + Backup
**Goal:** Protect current state and create rollback safety before destructive rewrite.

**Deliverables**
- Freeze merges during rewrite window
- Create mirror backup bundle of current remote state
- Snapshot leak manifest (known keys/files/commits)

**Acceptance Criteria**
- [ ] Backup bundle created and stored safely
- [ ] Leak manifest committed to private/internal note (not public)

**Validation Commands**
- `git clone --mirror git@github.com:automagik-dev/omni.git omni-mirror.git`
- `cd omni-mirror.git && git bundle create ../omni-pre-rewrite.bundle --all`
- `git show-ref | wc -l`

---

### Group B — Credential Revocation + Rotation
**Goal:** Neutralize exposed credentials before history rewrite is complete.

**Deliverables**
- Revoke leaked `omni_sk_*` keys
- Rotate replacement keys in prod/dev/OpenClaw configs
- Validate critical integrations still authenticate

**Acceptance Criteria**
- [ ] All leaked keys invalidated
- [ ] Replacement keys deployed and tested

**Validation Commands**
- `~/.omni/bin/omni api-keys list`
- `~/.omni/bin/omni health`
- Integration smoke checks (provider/message paths)

---

### Group C — Rewrite Spec + Dry Run (Mirror)
**Goal:** Build deterministic filter-repo recipe and verify outcome before touching origin.

**Deliverables**
- Rewrite script removing sensitive paths:
  - `HANDOFF.md`
  - `MEMORY.md`
  - `TOOLS.md`
  - `memory/`
- Optional text replacements for residual tokens in other files
- Dry-run report of ref changes

**Acceptance Criteria**
- [ ] Rewritten mirror has no target files across history
- [ ] No known leaked token matches remain

**Validation Commands**
- `git filter-repo --path HANDOFF.md --path MEMORY.md --path TOOLS.md --path memory --invert-paths --force`
- `git log --all -- HANDOFF.md MEMORY.md TOOLS.md memory`
- `git grep -n "omni_sk_" $(git rev-list --all)`

---

### Group D — Push Rewritten History + Branch Recovery
**Goal:** Replace remote history safely.

**Deliverables**
- Force-push rewritten refs (`main`, `dev`, active branches, tags as approved)
- Recreate protected branch settings if needed
- Validate GitHub UI no longer shows removed files/tokens

**Acceptance Criteria**
- [ ] Remote refs reflect rewritten SHAs
- [ ] Sensitive files inaccessible in web history

**Validation Commands**
- `git push --force --all origin`
- `git push --force --tags origin`
- Web verification on known leaked blob URLs

---

### Group E — Collaborator Migration + Guardrails
**Goal:** Prevent immediate relapse and align team workflow.

**Deliverables**
- Team notice with re-clone instructions
- `.gitignore` updates for sensitive operational files
- CI secret scan step (e.g., gitleaks/trufflehog)
- Optional pre-commit hook for local secret detection

**Acceptance Criteria**
- [ ] Team migration instructions published
- [ ] CI blocks future plaintext secret commits
- [ ] Sensitive local memory files excluded from public commits

**Validation Commands**
- `git status --ignored | grep -E 'HANDOFF.md|MEMORY.md|TOOLS.md|memory/'`
- `make check` (plus secret-scan job)
- Open PR with intentional fake secret to verify CI gate

---

## Notes

Known leaked set from current audit includes multiple real `omni_sk_*` values plus gateway token fragments and infrastructure details. Tunnel-only network exposure lowers direct exploitability but does not remove risk from credential replay, social engineering, or future topology shifts.

