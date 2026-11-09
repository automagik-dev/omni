# Owner decisions, 2026-11-01 (outside the round ledger)

- Agents pair with Omni: an agent (any harness) is a paired principal with its own child key, declares what it consumes in its manifest `accepts`, and receives deliveries asynchronously and outbound-only. The provider/call_agent path stays, unchanged. No direct agent-framework integrations in future Omni. Council: council-paired-agents-2026-11-01.md (proceed-with-conditions, conditions C0-C14).
- Delivery mode is set PER AGENT (an agent is either "called" via call_agent or a "subscriber" via an agent-owned consumer), so one event never reaches one agent both ways.
- The GitLab slice waits for the paired-agent slices (no interim bridge with unowned consumers).
