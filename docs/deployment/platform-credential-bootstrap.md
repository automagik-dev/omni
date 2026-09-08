# Platform credential bootstrap

How an operator of a fresh deployment creates the first PLATFORM-class
credential — the identity used to create tenants and delegate tenant-scoped
keys — **without direct SQL**. This is the sanctioned path the CLI's god-key
refusal points at: under `OMNI_DB_ENFORCEMENT=on` no data-plane god key can be
minted, so platform authority starts here.

## What it creates

One converged triple in the auth plane:

| Row | Purpose |
|-----|---------|
| `principals` | Stable operator identity (`--subject`, unique) |
| `platform_api_keys` | Platform key metadata (`--key-name`, unique) |
| `auth_credentials` (`credential_class='platform'`) | The hash-lookup index row the API authenticates against |

The rows satisfy every invariant the auth plane checks at resolution time
(matching key hash, principal, and scopes; no tenant bindings; active status).
After writing, the command verifies the credential **in-process** through the
same `AuthBootstrapService` lookup the API uses — no running API is required.

## Usage

Run server-side, wherever the deployment's database is reachable:

```bash
# Explicit URL (placeholders — substitute your own values):
bun scripts/bootstrap-platform-credential.ts --url postgres://DB_USER:DB_PASSWORD@DB_HOST:5432/omni

# Or rely on the environment the API itself uses:
DATABASE_URL=postgres://DB_USER:DB_PASSWORD@DB_HOST:5432/omni \
  bun scripts/bootstrap-platform-credential.ts
```

Useful options (see `--help` for all):

| Flag | Default | Meaning |
|------|---------|---------|
| `--subject` | `platform-operator` | Principal subject (stable identity) |
| `--key-name` | `platform-operator` | `platform_api_keys.name` |
| `--scope` | `platform:*` | Repeatable; scopes carried by the credential |
| `--rotate` | off | Replace the credential material for the same key |
| `--acknowledge-legacy-keys` | off | Proceed past the legacy god-key worklist |

The plaintext secret (`omni_sk_...`) is printed **exactly once** to stdout and
is never stored, logged, or included in the JSON report. Save it immediately —
recovery is `--rotate`, which invalidates the old secret.

## Idempotency, rotation, drift

- **Re-run = converge.** Running again with the same `--subject`/`--key-name`
  validates the existing triple and reports `converged`. No duplicate
  principals, keys, or credentials are ever created; no new secret is printed.
- **Rotation is explicit.** `--rotate` generates new material for the *same*
  principal and key row and re-verifies. The previous secret stops resolving
  immediately.
- **Drift is fail-closed.** If the stored rows disagree (tampered scopes,
  missing index row, mismatched hash), the run reports `blocked` with redacted
  reasons and writes nothing. Fix deliberately — usually with `--rotate`.
  A key bound to a different principal, or a revoked key, is never rebound or
  resurrected; choose a new `--key-name` instead.

## Legacy god keys

If the deployment still has legacy `api_keys` rows with the `*` scope or no
instance restriction, the command surfaces them through the report-only
classification worklist and **stops** (exit code 2). Those keys require an
explicit owner + purpose decision; the bootstrap never converts, promotes, or
revokes them. After reviewing the worklist, either revoke/scope the legacy
keys or re-run with `--acknowledge-legacy-keys` to proceed while leaving them
untouched.

## After bootstrapping

Use the platform credential against the platform control plane (for example
`POST /api/v2/platform/tenants` with an `x-platform-reason` header) to create
tenants, attach memberships, and issue tenant root keys — the delegation chain
the enforcement world expects. Day-to-day work should use tenant-scoped keys
delegated from this credential, not the platform credential itself.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | created / converged / rotated, and in-process verification passed |
| 1 | usage or connection error |
| 2 | legacy god-key worklist requires an explicit decision (nothing written) |
| 3 | blocked: drift or identity conflict (nothing written) |
| 4 | rows written but in-process verification failed — investigate |
