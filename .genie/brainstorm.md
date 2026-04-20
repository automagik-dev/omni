# Brainstorm Jar

## Raw

## Simmering

## Ready

## Poured
- **observability-hub** — SigNoz v0.119.0 EE backed multi-provider observability umbrella. DESIGN.md ready (WRS 100). P1 mostly done (SigNoz deployed @ 10.114.1.173, OTLP smoke passed, admin key saved). Spawns 3 child wishes: `p1-signoz-residual` (Discord channel + alerts), `p2-producers` (instrument Omni/Agno/Genie/System, 7 groups), `p3-pack-observability` (Next.js app + GitHub App, future khal-os home). Forward-compat contract: dual-emit W3C+khal-os headers, OTel resource attributes map to future FGA, `otlphttp/khalos` exporter stub in Collector config.
- **cli-360-agents-update-events-get-verbose-logs** — CLI gaps from #360: `agents update`, `events get`, `logs --verbose/--json`. DESIGN.md ready (WRS 100). One wish, 3 groups (G1 agents-update → G2 events-get → G3 logs-verbose). LogEntry schema gets explicit `data?: Record<string, unknown>`.
- **fix-omni-bugs-243-244** — API key chat scoping (#244) + event-driven media pipeline (#243). DESIGN.md ready. Council reviewed: APPROVE.
- **route-config-overrides** — Per-user/per-agent debounce/ack/split overrides on routes (#242). DESIGN.md ready. Kills the multi-Omni-installation hack.
- **omni-docs-cleanup** — Complete CLI reference (20 missing command groups, ~80 subcommands) + routing skill rewrite + multi-instance guide (#252, #240). DESIGN.md ready.
