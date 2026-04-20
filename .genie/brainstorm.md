# Brainstorm Jar

## Raw

## Simmering

## Ready

## Poured
- **observability-hub** — Vendor-neutral multi-provider observability umbrella. Producer code (Omni/Agno/Genie) uses vanilla OTel SDK + `OTEL_*` env vars only — zero backend vendor names in source. OTel Collector is the swappable boundary; backend is our operational choice (currently SigNoz Community EE v0.119.0 @ 10.114.1.173, deployed + ingesting). DESIGN.md ready (WRS 100). Spawns 3 wishes: `p1-backend-residual` (Discord channel + alerts on chosen backend), `p2-producers` (7 groups: 2.1–2.4 vendor-neutral upstream, 2.5–2.7 our infra), `p3-pack-observability` (Next.js app + GitHub App, data-source abstraction, future khal-os home).
- **cli-360-agents-update-events-get-verbose-logs** — CLI gaps from #360: `agents update`, `events get`, `logs --verbose/--json`. DESIGN.md ready (WRS 100). One wish, 3 groups (G1 agents-update → G2 events-get → G3 logs-verbose). LogEntry schema gets explicit `data?: Record<string, unknown>`.
- **fix-omni-bugs-243-244** — API key chat scoping (#244) + event-driven media pipeline (#243). DESIGN.md ready. Council reviewed: APPROVE.
- **route-config-overrides** — Per-user/per-agent debounce/ack/split overrides on routes (#242). DESIGN.md ready. Kills the multi-Omni-installation hack.
- **omni-docs-cleanup** — Complete CLI reference (20 missing command groups, ~80 subcommands) + routing skill rewrite + multi-instance guide (#252, #240). DESIGN.md ready.
