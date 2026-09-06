-- Ingress idempotency (#958, RFC #925 G2).
--
-- `WebhooksService.receive()` published a fresh event on every request with
-- no dedup anywhere on the path, so a provider redelivery (same GitHub
-- delivery id, 400ms apart) became two events → two automation firings →
-- duplicate destination rows. The fix: THE DATABASE dedupes via a unique
-- index, not application logic.
--
--   omni_events.idempotency_key   text, NULL for internal events without a
--                                 derivation (forward-only: the existing rows
--                                 have no reliably derivable key and stay
--                                 NULL). Webhook ingress claims the key by
--                                 inserting the journal row BEFORE publishing;
--                                 an ON CONFLICT miss means redelivery — the
--                                 emitter is acked (200) and no event exists.
--                                 Automation emit_event re-publishes claim
--                                 `derived:{parent_event_id}:{automation_id}:{action_index}`.
--
--   omni_events.event_type        widened 50 → 255: journaled webhook events
--                                 are typed `custom.webhook.{source}` and the
--                                 source name alone may be 100 chars.
--
--   webhook_sources.idempotency_key_template
--                                 per-source key derivation template;
--                                 existing sources migrate onto the body-hash
--                                 default `{source}:{sha256(body)}`.
--   webhook_sources.total_duplicates
--                                 redeliveries acked without a second event.
--
-- Index pair follows the additive-tenancy pattern of webhook_sources' name
-- indexes: a plain global unique (the ON CONFLICT target through the additive
-- phase) plus a tenant-scoped partial that positions RLS enforcement.
-- Postgres treats NULLs as distinct, so legacy rows never collide.
--
-- Hand-written following the 0052-0055 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent. No explicit
-- BEGIN/COMMIT — the boot migrator executes this file on a pooled postgres-js
-- connection, which rejects raw transaction control.

ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

ALTER TABLE "omni_events" ALTER COLUMN "event_type" TYPE varchar(255);

CREATE UNIQUE INDEX IF NOT EXISTS "omni_events_idempotency_key_uq"
  ON "omni_events" ("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "omni_events_tenant_idempotency_key_uq"
  ON "omni_events" ("tenant_id", "idempotency_key")
  WHERE "tenant_id" IS NOT NULL AND "idempotency_key" IS NOT NULL;

ALTER TABLE "webhook_sources"
  ADD COLUMN IF NOT EXISTS "idempotency_key_template" text NOT NULL DEFAULT '{source}:{sha256(body)}';

ALTER TABLE "webhook_sources"
  ADD COLUMN IF NOT EXISTS "total_duplicates" integer NOT NULL DEFAULT 0;
