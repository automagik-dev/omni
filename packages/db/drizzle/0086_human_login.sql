-- Human login on Better Auth (wish: omni-labs-distribution).
--
-- The tables Better Auth 1.7 needs for Omni's login (packages/api/src/login):
--
--   login_users          one owner: the first person to verify a phone number that
--                        is connected to this Omni's WhatsApp (the claim)
--   login_sessions       browser and device sessions
--   login_accounts       sign-in methods per user (Better Auth's own bookkeeping)
--   login_verifications  one-time codes (WhatsApp login codes)
--   login_passkeys       Face ID / Touch ID / fingerprint / security keys
--   login_device_codes   RFC 8628 device flow: the desktop app, DSH plugin and CLI
--
-- Column names are Better Auth's field names in snake_case, matched one to one by the
-- Drizzle schema. No tenant_id: login is off when multitenancy is on.
--
-- Journal `when` is 0085's + 2, not the usual + 100000000, on purpose: this ships
-- first on the `labs` branch and may be deployed before dev takes its own next
-- migration, which must still apply after it. When labs merges into dev this file is
-- renumbered after dev's (the parallel-worktree rule); every statement is
-- IF NOT EXISTS, so re-running it changes nothing.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

CREATE TABLE IF NOT EXISTS "login_users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "phone_number" text,
  "phone_number_verified" boolean,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "login_users_email_unique" UNIQUE ("email"),
  CONSTRAINT "login_users_phone_number_unique" UNIQUE ("phone_number")
);

CREATE TABLE IF NOT EXISTS "login_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "login_users"("id") ON DELETE CASCADE,
  CONSTRAINT "login_sessions_token_unique" UNIQUE ("token")
);
CREATE INDEX IF NOT EXISTS "login_sessions_user_id_idx" ON "login_sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "login_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "login_users"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "login_accounts_user_id_idx" ON "login_accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "login_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "login_verifications_identifier_idx" ON "login_verifications" ("identifier");

CREATE TABLE IF NOT EXISTS "login_passkeys" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "public_key" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "login_users"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL,
  "counter" integer NOT NULL,
  "device_type" text NOT NULL,
  "backed_up" boolean NOT NULL,
  "transports" text,
  "created_at" timestamp with time zone,
  "aaguid" text
);
CREATE INDEX IF NOT EXISTS "login_passkeys_user_id_idx" ON "login_passkeys" ("user_id");
CREATE INDEX IF NOT EXISTS "login_passkeys_credential_id_idx" ON "login_passkeys" ("credential_id");

CREATE TABLE IF NOT EXISTS "login_device_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "device_code" text NOT NULL,
  "user_code" text NOT NULL,
  "user_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "last_polled_at" timestamp with time zone,
  "polling_interval" integer,
  "client_id" text,
  "scope" text,
  CONSTRAINT "login_device_codes_device_code_unique" UNIQUE ("device_code"),
  CONSTRAINT "login_device_codes_user_code_unique" UNIQUE ("user_code")
);
