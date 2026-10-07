# Adapter publication validation

Validated locally on 2026-10-06 for branch `codex/zapi-evolution-api`, based on upstream `dev` commit `2451154` (release `2.261006.2`).

- 511 tests passed across 13 selected suites: Evolution and Z-API transports/lifecycle, instance configuration, tenant credential sealing, SDK compliance, event capabilities, media/template API contracts, route ownership and egress architecture guards.
- Root `bun run typecheck`: 29/29 tasks successful, including API, SDK, CLI, UI and channel packages.
- Root Biome lint passed across the repository.
- Migration contract vs `origin/dev` passed: 38 contract tests, two new additive migrations and a consistent journal. No database was accessed and no migration was applied.
- Version registry passed: all package versions match the upstream release.
- OpenAPI TypeScript SDK regenerated locally.
- Knip passed after removing unused API channel dependencies and unused exports.

The publication contains the reusable adapters and their shared Omni integration. Private deployment configuration and consumer endpoints are excluded.

Live provider compatibility, rendered UI verification and disposable-database migration execution have not been performed. Validate exact provider versions and account capabilities before rollout. Evolution history, quoted sends, reactions and authenticated inbound media retrieval remain follow-up work as documented in `evolution-api.md`.
