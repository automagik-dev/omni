-- Slack user token + auth mode on instances (#889).
--
-- authMode 'user' makes the plugin act as the human who authorized the app
-- rather than as the bot: posts, edits and reactions are attributed to them,
-- and search.messages becomes callable (no bot token can search).
--
-- Until now the user token could only reach the plugin through `credentials`
-- or inline config, i.e. never through the sealed column path every other
-- channel credential uses.
--
-- slack_user_token joins the sealed credential set (SEALED_CREDENTIAL_COLUMNS
-- in services/instances.ts), so it is encrypted at rest under the owning
-- tenant and redacted on read like slack_bot_token.
--
-- Operational note worth keeping in mind: unlike a bot token, this one is
-- bound to a PERSON. It stops working when that account is deactivated, and
-- everything it did is attributed to them.
--
-- slack_auth_mode is left nullable rather than defaulted to 'bot' so existing
-- rows stay untouched; the plugin already treats absent as 'bot'.
--
-- Hand-written following the 0044-0049 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "slack_user_token" text;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "slack_auth_mode" varchar(10);
