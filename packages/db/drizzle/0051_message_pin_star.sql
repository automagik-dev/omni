-- Per-message pin and star (#889).
--
-- `chats.settings->>'pinned'` already existed but is a different thing: it
-- pins the CONVERSATION in the sidebar. There was nowhere to record that a
-- particular MESSAGE was pinned or starred, so the starMessage plugin call
-- had no persistence behind it at all — the state lived only on the platform.
--
-- pinned_by holds the platform user id that pinned it (Slack reports one);
-- null means we know it is pinned but not by whom.
--
-- Hand-written following the 0044-0050 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "pinned_by" varchar(255);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "starred_at" timestamp with time zone;

-- Partial indexes: the vast majority of rows are neither pinned nor starred.
CREATE INDEX IF NOT EXISTS "messages_pinned_idx"
  ON "messages" ("chat_id", "pinned_at") WHERE "pinned_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "messages_starred_idx"
  ON "messages" ("chat_id", "starred_at") WHERE "starred_at" IS NOT NULL;
