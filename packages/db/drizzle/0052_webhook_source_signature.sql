-- Webhook source signature verification (#928).
--
-- The generic webhook ingress (POST /api/v2/webhooks/:source) validated
-- expected headers by PRESENCE only — any value passed. These columns let a
-- source carry a real verification contract, checked before anything is
-- published to the bus:
--
--   signature_config  jsonb  { algorithm: 'hmac-sha256'|'hmac-sha1'|'token-match',
--                              header: string, prefix?: string }
--   signature_secret  text   the shared secret; sealed per-tenant via
--                            sealCredentialField like other credential columns,
--                            never returned by the API.
--
-- A source with signature_config set is verifiable by the auth-exempt public
-- ingress route (POST /api/v2/webhooks/ingress/:source); a source without one
-- stays reachable only through the authenticated route.
--
-- Hand-written following the 0044-0051 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "signature_config" jsonb;
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "signature_secret" text;
