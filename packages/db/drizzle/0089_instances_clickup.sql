-- ClickUp channel credentials (issue #1413).
--
--   instances.clickup_api_token  per-user ClickUp personal API token; sealed at
--                                rest like the other channel credential columns
--                                (SEALED_CREDENTIAL_COLUMNS). The column holds
--                                plaintext only while sealing is flag-off or
--                                the master key is absent.
--   instances.clickup_team_id    numeric ClickUp team (workspace) id
--   instances.clickup_list_id    numeric default ClickUp list id
--
-- ClickUp is a non-messaging channel: these columns credential task actions,
-- not a chat transport. Additive and idempotent; hand-written following the
-- 0043/0044/0052 precedent. No explicit BEGIN/COMMIT — the boot migrator
-- executes this file on a pooled postgres-js connection, which rejects raw
-- transaction control.
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "clickup_api_token" text;
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "clickup_team_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "clickup_list_id" varchar(64);
