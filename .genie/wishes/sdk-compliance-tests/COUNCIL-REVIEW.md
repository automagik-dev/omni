# Council Review: SDK Compliance Test Suite (#82)

**Date:** 2026-03-11
**Vote:** 0 APPROVE, 5 MODIFY, 0 REJECT

---

## Perspectives

### questioner (MODIFY)
- Blockers #81, #85, #86 make behavioral tests fragile now — tests must account for current vs expected state
- Compliance with SDK contract vs compliance with each other are different things — need clarity
- Parameterization across 4 channels with vastly different capabilities may not fit cleanly in one suite

### simplifier (MODIFY)
- Proposal conflates 3 questions: hierarchy (structural), utility usage (behavioral), capability consistency (meta)
- Split into focused test groups, each answering one question clearly
- 14 inconsistencies found — but what *types*? Different patterns need different tests

### benchmarker (MODIFY)
- Importing 4 plugin classes pulls heavy deps (discord.js, grammy, Baileys, Bolt) — test cost matters
- Structural/reflection tests: sub-1ms; behavioral tests: gate behind env flag until blockers close
- Use source-reading approach for utility/journey verification instead of runtime instantiation

### architect (APPROVE with modifications)
- SDK owns contract definition — structural tests belong in channel-sdk
- Behavioral tests could live in each channel package to avoid mega-dependency
- SDK should export a ComplianceContract that channels validate against
- For each capability=true, assert method exists and is callable — don't test behavior

### measurer (MODIFY)
- No baseline snapshot of correct SDK usage per channel exists
- Compliance suite alone won't catch drift if channels silently stop using emit methods
- Add golden file tests that fail visibly when drift occurs (deferred to future wish)

### operator (MODIFY)
- If tests import actual plugins and blockers aren't resolved, tests fail immediately in CI
- Solution: `todo()` stubs for blocked tests; structural tests work today
- Document: "Tests will fail until #81, #85, #86 are resolved"

---

## Synthesized Recommendation

Adopt a phased, contract-first approach:
1. Define compliance via channel descriptors (what each channel should have)
2. Structural tests first (no blockers, fast, reflection-based)
3. `todo()` stubs for blocker-dependent tests
4. Source-level verification for utilities and journey timing (read files, check imports)
5. No plugin instantiation — all tests are reflection/source-level
