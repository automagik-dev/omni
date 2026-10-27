-- API key lineage (wish: omni-chat-threads, Group 1).
--
--   api_keys.parent_key_id      the key a child was minted from (POST /keys/children);
--                               null for every root key, so existing rows are unchanged
--   api_keys_parent_key_id_fk   ON DELETE CASCADE: deleting a parent removes its children's
--                               rows. ApiKeyService revokes them first, publishing
--                               access.key_revoked for each; the cascade also catches a raw
--                               delete that skips the service
--   api_keys_parent_key_id_idx  backs the FK cascade: deleting a parent finds every child
--                               row, live or not
--   api_keys_parent_key_live_idx  partial (status = 'active'): the parent's mint, revoke,
--                               delete and PATCH find its live children, and "act only on
--                               your own children" checks the column
--
-- "Own children" needs a structural check: created_by is free text.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "parent_key_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'api_keys_parent_key_id_fk' AND conrelid = '"api_keys"'::regclass
    ) THEN
        ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_parent_key_id_fk" FOREIGN KEY ("parent_key_id") REFERENCES "api_keys" ("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_parent_key_id_idx" ON "api_keys" ("parent_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_parent_key_live_idx" ON "api_keys" ("parent_key_id") WHERE "status" = 'active';
