-- Gupshup per-instance handoff options.
--
-- One jsonb column holding routing defaults and the Custom Integration
-- `customerFields` template for HANDOFF messages:
--
--   gupshup_handoff_options  jsonb  { defaultFields?:        Record<string,string>,
--                                     fieldsByPhonePrefix?:  Array<{ prefixes: string[],
--                                                                     fields: Record<string,string> }>,
--                                     customerFields?:       Array<{ apiKey: string,
--                                                                     value?: string, from?: string }> }
--
-- Shape is validated by the channel plugin on connect
-- (packages/channel-gupshup/src/handoff-options.ts). Not a credential: the
-- column is returned by the instances API like gupshup_event_id.
--
-- Hand-written following the 0044-0052 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "gupshup_handoff_options" jsonb;
