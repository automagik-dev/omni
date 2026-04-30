-- Backfill: unstick chats that were auto-promoted to a hard terminal by
-- the redirected_sac escalation rule. The companion fix in
-- packages/api/src/routes/v2/_close-contact-config.ts removes the
-- escalation for `redirected_sac` going forward (an active Hapvida client
-- legitimately ends every conversation with a SAC redirect, so counting
-- repeats and silencing the agent at threshold == 2 produced false
-- positives that left real customers without a reply).
--
-- This migration flips `chats.settings.closed` back to false for any chat
-- whose closeOutcome is `redirected_sac`. Other settings (`closeUntil`,
-- `closeOutcome`, `closeContactLogs` audit history) are left intact —
-- this is the minimum write required to let the dispatcher's
-- close-contact gate stop returning `skip` (it gates on `closed === true`)
-- so reactive replies resume.
--
-- Hard terminals from `won`/`lost` are not touched: they are intentionally
-- terminal and only `/chats/:id/reopen-contact` should clear them.
--
-- Hand-written (not `drizzle-kit generate`) because the change is a JSONB
-- merge on the existing settings column with a filtered predicate, which
-- drizzle-kit cannot emit directly.

UPDATE "chats"
SET "settings" = "settings" - 'closed' || jsonb_build_object('closed', false)
WHERE ("settings"->>'closed')::boolean IS TRUE
  AND "settings"->>'closeOutcome' = 'redirected_sac';
