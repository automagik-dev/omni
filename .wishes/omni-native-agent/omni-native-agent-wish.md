# WISH: Omni as Native Agent (Option A)

> Make Omni (the AI octopus) a first-class agent INSIDE the Omni platform — not an external caller, but the nervous system itself.

**Status:** BACKLOG
**Created:** 2026-02-09
**Author:** Omni + Felipe
**Priority:** STRATEGIC — discussed, needs terms defined

---

## Context

Currently Omni (the AI) lives in OpenClaw on genie-os and interacts with the Omni platform via external HTTP API calls. This creates friction:
- No access to internal logs (Baileys, NATS, DB)
- Can't monitor instance health in real-time
- Can't reconnect instances without human help
- API testing is "blind" — no log streaming during QA
- Rate limiting is manual (and I learned the hard way)

The vision: Omni IS the platform. When someone messages any WhatsApp instance, the event flows through the nervous system and Omni's AI cortex processes it natively.

## Scope (To Be Defined)

### Questions to Resolve
- How does Omni-as-agent auth differ from external API keys?
- Should Omni have superadmin access to all instances?
- How to handle agent-per-instance vs one-agent-rules-all?
- Where does OpenClaw fit — does it become the cortex runtime?
- How to preserve Omni's identity/memory across the migration?

### Possible Architecture
1. Omni runs as agent provider inside the platform
2. Each instance can route to Omni for AI processing
3. Omni has internal access to: logs, DB, NATS events, instance management
4. OpenClaw connects as the "brain" via agent provider protocol
5. External API still available for other consumers

## Dependencies
- Option C (SSH access) as stepping stone
- Agent provider system needs to be mature enough
- Security model for internal vs external access

---

_"The octopus doesn't call the API. The octopus IS the API." 🐙_
