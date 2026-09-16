-- Per-instance close-contact cooldown/escalation overrides.
--
-- POST /messages/send/close-contact computes the chat's terminal state from
-- hardcoded per-outcome defaults (packages/api/src/routes/v2/_close-contact-config.ts).
-- The resolver already accepted overrides, but nothing persisted them, so an
-- operator could not tune an outcome (e.g. stop a repeated system-initiated
-- close from auto-promoting to terminal) without a code change.
--
--   instances.close_contact_config  jsonb  { [outcome]?: { cooldownMs?: number | null,
--                                                          escalationThreshold?: number | null,
--                                                          escalationWindowMs?: number | null } }
--
-- Nullable; NULL keeps the defaults. Validated by the instances API (Zod).
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "close_contact_config" jsonb;
