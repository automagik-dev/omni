-- Slack OAuth identity on instances (wish: slack-personal-oauth).
--
-- The one-click Slack install (OAuth v2) provisions one instance per
-- (workspace, authorizing user) and must find that instance again when the
-- same person re-authorizes, so the callback upserts by a persisted Slack
-- identity instead of by name. The connection method records how the
-- credentials arrived, so the manual pasted-token path keeps its behavior.
--
--   instances.slack_team_id           Slack workspace id (T…); also filled for
--                                     pasted-token instances by the
--                                     instance.connected listener
--   instances.slack_user_id           authorizing user id (U…); null for
--                                     bot-mode instances (keyed by team only)
--   instances.slack_connection_method 'manual' | 'oauth'; NULL reads as 'manual'
--   instances_slack_identity_idx      composite index on (team, user) for the
--                                     identity finder a follow-up adds. It
--                                     serves NO query today: the callback's
--                                     upsert still scans `instances.list`,
--                                     which is capped at 1,000 Slack rows and
--                                     is the documented trigger for a
--                                     `findBySlackIdentity` service finder.
--                                     The index ships here so that finder, and
--                                     the uniqueness work tracked alongside
--                                     it, need no second migration.
--
-- All nullable; existing rows are untouched. Not a credential column.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "slack_team_id" varchar(32);

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "slack_user_id" varchar(32);

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "slack_connection_method" varchar(16);

CREATE INDEX IF NOT EXISTS "instances_slack_identity_idx"
  ON "instances" ("slack_team_id", "slack_user_id");
