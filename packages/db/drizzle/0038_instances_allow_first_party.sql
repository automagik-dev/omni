-- Per-instance first-party cross-instance opt-in.
--
-- Adds `instances.allow_first_party` (default false). When true, the agent
-- dispatcher will NOT drop inbound messages whose sender phone matches another
-- active instance's owner. This lets a user's "assistant" instance reply to
-- messages sent from their own personal number (which is another instance's
-- owner) instead of silently dropping them via loop protection.
--
-- Default false preserves current loop-protection behavior for every existing
-- instance. Opt in per-instance via:
--
--   omni instances update <id> --allow-first-party
--
-- Does NOT affect the separate "message from self" self-skip — an instance
-- still never replies to its own outbound. See `isFirstPartyInstanceSender`
-- and the gate in packages/api/src/plugins/agent-dispatcher.ts.
--
-- Hand-written (not `drizzle-kit generate`) to avoid the gupshup column
-- rename prompts that block non-interactive runs in this repo.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "allow_first_party" boolean DEFAULT false NOT NULL;
