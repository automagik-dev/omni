-- Presence-debounce max-wait cap (presence-debounce-batching design, 2026-07).
--
-- Adds `message_debounce_max_wait_ms` to both the `instances` table and the
-- per-route `agent_routes` override table. It is the hard cap for the new
-- 'presence' debounce mode: a batch flushes at `firstBuffered + maxWaitMs`
-- even while the user keeps typing, so a continuously-composing user can never
-- starve the agent. NULL = no cap (the legacy fixed/randomized behavior).
--
-- The 'presence' mode itself is a TypeScript-layer literal (message-debouncer
-- DebounceConfig + the `debounceMode` const in schema.ts). The DB stores mode
-- as a free varchar(20) with no CHECK constraint, so no enum migration is
-- needed here — only the new nullable column.
--
-- Hand-written (not `drizzle-kit generate`) to match the repo convention from
-- 0032+ and avoid the gupshup column-rename prompts that block non-interactive
-- runs.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "message_debounce_max_wait_ms" integer;

ALTER TABLE "agent_routes"
  ADD COLUMN IF NOT EXISTS "message_debounce_max_wait_ms" integer;
