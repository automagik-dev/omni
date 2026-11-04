-- Zenvia channel — per-instance configuration.
--
-- Adds the three instance columns the `@omni/channel-zenvia` plugin reads:
--   * zenvia_api_token         — API token (`X-API-TOKEN` header); sealed at
--                                rest by the instances service like the other
--                                channel credential columns
--   * zenvia_sender_id         — sender registered at Zenvia (the WhatsApp
--                                number), sent as `from` on every message
--   * zenvia_handoff_solution  — `conversation.solution` a handoff routes to
--                                (conversion | zenvia_chat | nlu)
--   * zenvia_sales_api_key     — key for the Zenvia Sales APIs (`api-key`
--                                query parameter, not the same token as the
--                                API token); sealed at rest
--   * zenvia_handoff_group_id  — Sales group dedicated to the chatbot, the
--                                target of the handoff transfer
--   * zenvia_handoff_user_id   — optional agent inside that group
-- With the Sales key and group set the handoff transfers the prospect;
-- otherwise it falls back to the solution; with neither it is refused.
-- The optional webhook verify token reuses the existing shared
-- webhook_verify_token column (Gupshup precedent) — no new column.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent,
-- no rewrite: ADD COLUMN with no default does not rewrite the table).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single batch, idempotent statements.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "zenvia_api_token" text,
  ADD COLUMN IF NOT EXISTS "zenvia_sender_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "zenvia_handoff_solution" varchar(32),
  ADD COLUMN IF NOT EXISTS "zenvia_sales_api_key" text,
  ADD COLUMN IF NOT EXISTS "zenvia_handoff_group_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "zenvia_handoff_user_id" varchar(64);
