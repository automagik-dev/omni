-- Per-instance stale-reply policy for the agent dispatcher.
--
-- Adds `instances.message_supersede_mode` ('off' | 'discard', default 'off').
-- When 'discard', an agent reply whose input snapshot is already stale — i.e.
-- newer inbound arrived for the chat while the agent was still running — is
-- dropped instead of delivered. The message debouncer's finally-block re-flush
-- then dispatches the buffered messages immediately, so the follow-up run
-- answers everything with full context and the user never receives an
-- out-of-date reply (e.g. a question they already answered).
--
-- Default 'off' preserves current delivery behavior for every existing
-- instance. See `isReplySuperseded` and the gates in
-- packages/api/src/plugins/agent-dispatcher.ts.
--
-- Hand-written (not `drizzle-kit generate`) to avoid the gupshup column
-- rename prompts that block non-interactive runs in this repo.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "message_supersede_mode" varchar(20) DEFAULT 'off' NOT NULL;
