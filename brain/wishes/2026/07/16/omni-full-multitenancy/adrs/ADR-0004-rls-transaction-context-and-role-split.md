<!-- adr_topic: rls_transaction_context_role_split -->
# ADR-0004 — Transaction-local RLS context and runtime/migration role split

- Status: proposed (G0 gate)

## Context
The dedicated runtime role is provisioned `NOBYPASSRLS` (role-cutover.ts:232-235) but the
cutover is best-effort and can fall back to the legacy `postgres:postgres` superuser
(role-cutover.ts:194-200). A pooled postgres.js connection must never carry session-level
tenant state.

## Decision
- Tenant tables use `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- RLS policy reads a transaction-local setting `app.tenant_id` and fails closed when unset/invalid; `INSERT`/`UPDATE` use `WITH CHECK`; `SELECT`/`DELETE` use tenant equality.
- Every tenant request/job runs through a single `withTenantTransaction(authContext, fn)` that calls `set_config('app.tenant_id', ..., true)` (transaction-local) and keeps all repository/service queries in the same transaction. No session-level `SET` on pooled connections.
- Composite keys/FKs (e.g. `(tenant_id, chat_id)` → `(tenant_id, id)`) prevent cross-tenant joins.
- Normal runtime role: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; cannot own tenant tables, hold `CREATE`, alter policies, `SET ROLE`, set `row_security=off`, or run an unhardened `SECURITY DEFINER`. `PUBLIC` privileges revoked; `search_path` pinned.
- Migration/DDL credentials are separate and unavailable to the app process after boot.
- **The `postgres:postgres` superuser fallback is removed once RLS is a security boundary; runtime startup fails closed if the NOBYPASSRLS role is absent — no silent superuser fallback.**

## Consequences
- G3 delivers the transaction helper, role split, static guards against singleton/direct DB use, and fail-closed startup.
- Real-PostgreSQL integration tests are mandatory (context reset on pooled connections, missing-context denial, FORCE RLS, no superuser fallback).

## Preserves
WISH "Database enforcement"; Success Criteria 9, 10; QA DB/RLS integration tests.
