-- Slack OAuth identity uniqueness (#1235, follow-up to #1233).
--
-- The OAuth callback upserts one instance per Slack identity, but nothing in
-- the database enforced it: two callbacks for the same identity landing
-- together could both insert. These partial unique indexes make the identity
-- a constraint and give the upsert an ON CONFLICT target:
--
--   instances_slack_oauth_user_uq  (slack_team_id, slack_user_id) for
--                                  user-mode OAuth rows
--   instances_slack_oauth_bot_uq   (slack_team_id) for bot-mode OAuth rows
--                                  (NULL slack_user_id) — two bot installs
--                                  for one workspace are one identity
--
-- Only slack_connection_method = 'oauth' rows are covered: the
-- instance.connected listener also fills the identity columns of manual
-- pasted-token instances, which may legitimately repeat.
--
-- Duplicate-row policy: detect and refuse. A database that already holds two
-- OAuth rows for one identity cannot build the index, so the DO block below
-- fails the migration with the duplicate instance ids instead. Resolve by
-- deleting the extra instance(s), then restart; nothing is deduped
-- automatically because each row carries its own live tokens.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(
           format('team %s %s: instances %s',
                  slack_team_id,
                  COALESCE('user ' || slack_user_id, '(bot)'),
                  ids),
           '; ')
    INTO duplicates
    FROM (
      SELECT slack_team_id, slack_user_id, string_agg(id::text, ', ' ORDER BY created_at) AS ids
        FROM "instances"
       WHERE slack_connection_method = 'oauth' AND slack_team_id IS NOT NULL
       GROUP BY slack_team_id, slack_user_id
      HAVING count(*) > 1
    ) d;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate Slack OAuth instances for one identity (#1235): %. Delete the extra instance(s) and restart.', duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "instances_slack_oauth_user_uq"
  ON "instances" ("slack_team_id", "slack_user_id")
  WHERE "slack_connection_method" = 'oauth' AND "slack_user_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "instances_slack_oauth_bot_uq"
  ON "instances" ("slack_team_id")
  WHERE "slack_connection_method" = 'oauth' AND "slack_user_id" IS NULL;
