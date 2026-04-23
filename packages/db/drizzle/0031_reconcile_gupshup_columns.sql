-- Issue #407: reconcile gupshup column drift.
--
-- Migration 0018_supreme_puma renamed three columns on "instances":
--   gupshup_api_key       -> gupshup_callback_url
--   gupshup_app_name      -> gupshup_auth_token
--   gupshup_source_phone  -> gupshup_event_id
--
-- On at least one deployed DB the migration was marked applied in
-- drizzle.__drizzle_migrations but the rename never executed, leaving the
-- live table with the old column names. Because RENAME is not idempotent,
-- replaying 0018 would fail. This migration is safe to rerun: it adds the
-- new columns if missing, copies any surviving data from old columns, and
-- then drops the old columns if present.

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "gupshup_callback_url" text;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "gupshup_auth_token" text;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "gupshup_event_id" varchar(255);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'instances' AND column_name = 'gupshup_api_key'
  ) THEN
    EXECUTE 'UPDATE "instances" SET "gupshup_callback_url" = "gupshup_api_key" WHERE "gupshup_callback_url" IS NULL AND "gupshup_api_key" IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'instances' AND column_name = 'gupshup_app_name'
  ) THEN
    EXECUTE 'UPDATE "instances" SET "gupshup_auth_token" = "gupshup_app_name" WHERE "gupshup_auth_token" IS NULL AND "gupshup_app_name" IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'instances' AND column_name = 'gupshup_source_phone'
  ) THEN
    EXECUTE 'UPDATE "instances" SET "gupshup_event_id" = "gupshup_source_phone" WHERE "gupshup_event_id" IS NULL AND "gupshup_source_phone" IS NOT NULL';
  END IF;
END $$;

ALTER TABLE "instances" DROP COLUMN IF EXISTS "gupshup_api_key";
ALTER TABLE "instances" DROP COLUMN IF EXISTS "gupshup_app_name";
ALTER TABLE "instances" DROP COLUMN IF EXISTS "gupshup_source_phone";
