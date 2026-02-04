# WISH: PIX Button Research

> Investigate if native WhatsApp PIX buttons are feasible.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-rx3

---

## Context

**Goal:** Determine if we can support native WhatsApp PIX 'copia e cola' messages with the payment_info button.

**Background:**
- Native payment_info button requires WhatsApp Business account
- Regular accounts silently ignore the message (sends but doesn't render)
- Some Baileys forks claim to support this

---

## Scope

### IN SCOPE

- Research feasibility
- Document findings
- Recommend next steps

### OUT OF SCOPE

- Implementation (depends on research outcome)

---

## Execution

**Research Questions:**
1. Does `payment_info` require WhatsApp Business account?
2. Do any Baileys forks enable this for regular accounts?
3. Is there an alternative message format?
4. Should we use QR code image fallback?

**Deliverables:**
- [ ] Document findings
- [ ] Recommendation: implement, defer, or use fallback
- [ ] If feasible: create follow-up bead for implementation

**Acceptance Criteria:**
- [ ] Clear answer on feasibility
- [ ] Decision documented
- [ ] Next steps defined
