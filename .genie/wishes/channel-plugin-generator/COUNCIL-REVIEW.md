# Council Review: Channel Plugin Template/Generator

**Issue:** #92 — [P3][feature] Create channel plugin template/generator
**Date:** 2026-03-11
**Blocked by:** #82 (compliance test suite — OPEN)

---

## Perspectives

### Architect (APPROVE)

- Architecture is sound — string templates with 5-10 variables (name, display, channelId, capabilities flags) are sufficient. No template engine needed.
- Generated skeleton should mirror `channel-whatsapp/` structure (proven production pattern): plugin.ts, capabilities.ts, handlers/, senders/, utils/, types.ts, CLAUDE.md.
- Generator should NOT mutate core types (ChannelType enum). Instead, document that adding to the enum is a separate 1-line change. Generator stays decoupled from core.
- Optional features (streaming, history, reactions) should NOT be pre-generated. Keep minimal; developers add complexity on demand.

### Simplifier (APPROVE with constraints)

- Generated code should be truly minimal — "hello world that compiles", not "production stubs that do nothing."
- Target ~600 LOC generated, not 2000. Include:
  1. Plugin class with all abstract properties/methods stubbed
  2. Dedupe, download guard, sanitization initialized
  3. One test that imports and instantiates (compile check)
  4. CLAUDE.md skeleton
- Do NOT generate: empty handler files, empty sender dirs, auth logic, connection code.

### Operator (MODIFY)

- Add overwrite protection: warn if `packages/channel-{name}/` already exists, require `--force`.
- Mark generated packages with `_generated: true` and `_templateVersion` in package.json for tracking.
- CI auto-discovery via workspace glob works — no changes needed.
- Generator should warn about ChannelType enum not being auto-updated.

### Questioner (MODIFY)

- #82 (compliance suite) is OPEN. Without it, how do we validate generated code is actually compliant?
- Workspace registration: pnpm-workspace/bun workspace already globs `packages/*` — generator doesn't need to touch root config.
- Template maintenance: if BaseChannelPlugin evolves, template drifts. Document template version and sync mechanism.

### Measurer (MODIFY)

- Can't measure compliance yet (#82 pending). However, generator can target the compliance spec from the issue description.
- Generate a test channel (channel-example) and verify it compiles + passes basic structural checks.
- Success metric: new channels take <30 min to scaffold (vs hours of copy-paste).

### Benchmarker (MODIFY)

- Generator runs once per channel — performance irrelevant.
- Maintenance cost: if template needs 3 updates/year for SDK evolution and 4 channels generated/year, that's manageable.
- Make compliance-test-first a hard requirement before calling this "done" (but can build generator now).

---

## Vote Summary

| Perspective | Vote |
|-------------|------|
| Architect | APPROVE |
| Simplifier | APPROVE |
| Operator | MODIFY |
| Questioner | MODIFY |
| Measurer | MODIFY |
| Benchmarker | MODIFY |
| **Net** | **Conditional approval** |

---

## Synthesized Recommendations

1. **Proceed with generator implementation** — the design is architecturally sound.
2. **Keep it simple**: string templates, minimal output (~600 LOC), `--name` and `--display` flags only.
3. **Don't mutate core**: generator does NOT modify ChannelType enum. Document as manual step.
4. **Operator safeguards**: overwrite protection (`--force`), `_generated` marker in package.json.
5. **#82 dependency is soft**: generator can target the compliance spec without the test suite existing. When #82 lands, generated channels should pass automatically.
6. **Validation approach**: generate a test channel, verify it compiles and instantiates correctly.
