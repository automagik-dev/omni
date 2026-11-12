-- Zenvia channel — per-instance media host list (#1667).
--
-- Adds one instance column the `@omni/channel-zenvia` plugin reads at connect:
--   * zenvia_media_hosts  — jsonb array of host names inbound media may be
--                           downloaded from, each covering its subdomains.
--                           NULL or an empty array keeps the previous
--                           behavior: any host that resolves only to public
--                           addresses.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent,
-- no rewrite: ADD COLUMN with no default does not rewrite the table).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single batch, idempotent statements.

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "zenvia_media_hosts" jsonb;
