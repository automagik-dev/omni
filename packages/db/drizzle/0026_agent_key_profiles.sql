-- Omni scope profiles: add profile + allowlist columns to `api_keys`.
--
-- Existing keys are backfilled as follows:
--   * `profile` stays NULL — they keep their hand-authored `scopes`
--   * `profile_overrides` defaults to `'{}'::jsonb`
--   * `chat_allowlist` / `instance_allowlist` / `outbound_recipient_allowlist`
--     default to empty arrays. For NULL-profile keys the enforcer treats `[]`
--     as "no lock" (backward compat). For profile keys that declare
--     `requiresLocks`, `[]` means "deny all" — see docs/profiles.md.

ALTER TABLE "api_keys" ADD COLUMN "profile" varchar(32);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "profile_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "chat_allowlist" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "instance_allowlist" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "outbound_recipient_allowlist" text[] DEFAULT ARRAY[]::text[] NOT NULL;
