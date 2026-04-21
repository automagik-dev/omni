-- Per-instance bridge tmux session override for the genie `nats-genie` provider.
--
-- When set, the provider propagates this value via the NATS message env as
-- `GENIE_TMUX_SESSION`; the consumer genie bridge uses it as the highest-
-- priority override in its three-layer tmux-session resolution chain.
-- NULL keeps today's behavior (no override, genie falls back to agent-level
-- or name-based defaults).
--
-- Enables one-agent-many-instances fan-out — e.g. a single "scout" agent
-- hooked to N inbound numbers lands each instance's dispatches in its own
-- tmux session for isolation and live-intelligence observability.

ALTER TABLE "instances" ADD COLUMN "bridge_tmux_session" text;
