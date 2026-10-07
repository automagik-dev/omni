# Evolution adapter validation

Local validation on 2026-10-06, branch `codex/evolution-api-adapter`, based on `5e20fe4`.

- 478 tests passed across 9 selected suites: Evolution transport/lifecycle, Evolution and Z-API instance routes, Z-API transport regressions, tenant credential sealing, SDK compliance, event-capability declarations and existing SDK request contracts.
- Root `bun run typecheck`: 29/29 tasks successful, including API, SDK, CLI, UI and all channel packages.
- Biome checks on all changed/new TypeScript, TSX and JSON sources passed.
- Migration contract vs HEAD passed: 38 contract tests and validation of the new additive migration/journal pair. No database was accessed and no migration was applied.
- Version registry passed: 30/30 files match the root version.
- Bundled server build succeeded: 4,514 modules bundled with the new channel included. The artifact was not executed.

General architecture checks remain blocked by pre-existing consumer integration declarations:

- Egress guard: `packages/api/src/routes/v2/consumer-avatar.ts` (1 site) and `packages/api/src/routes/v2/consumers.ts` (2 sites) lack registrations.
- Route ownership: `GET /api/v2/consumers/connections/:accountId/avatar`, `GET /api/v2/consumers/connections/:accountId/changes`, `GET /api/v2/consumers/readiness`, and `POST /api/v2/consumers/connections` lack declarations.
- Knip: existing unused `@omni/channel-zapi-omni` API dependency, `zod` dependency in that channel, `validZapiBinding`, and `MAX_BODY_BYTES` exports.

Compared the architecture reports with the registry/declaration sources from HEAD, excluding the newly added Evolution route/package from the baseline. The unregistered sites and undeclared routes are identical. The new Evolution egress site and webhook route are registered. No new Knip findings remain.

Live compatibility, rendered UI verification and disposable-database migration execution were not performed. These require the subsequent integration/rollout stage; this change only uses mocks and static tooling.
