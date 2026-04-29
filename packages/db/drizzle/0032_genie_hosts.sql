-- Per-host fingerprint trust foundation (omni-host-fingerprint-trust wish, Group 1).
--
-- Stores ed25519 public keys for genie installations that talk to this omni
-- server. Populated by `POST /api/v2/trust/handshake` (driven by
-- `genie omni handshake`). Read by the verification middleware (Group 4) on
-- every signed request, and by `omni trust list/get/update/revoke`.
--
-- This is the FOUNDATION migration: the table just stores data. Signing,
-- verification, and per-host scope enforcement land in subsequent groups
-- of the same wish. The bearer-token auth model stays untouched and
-- backward-compatible until operators opt into per-instance enforcement.
--
-- Idempotency invariant: pubkey is UNIQUE — re-registering the same key
-- returns the existing host_id rather than creating duplicates. Rotation
-- (Group 2) revokes + re-registers with a new pubkey, never mutates in
-- place.

CREATE TABLE IF NOT EXISTS "genie_hosts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "pubkey" varchar(64) NOT NULL UNIQUE,
    "hostname" varchar(255) NOT NULL,
    "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "scopes" text[] DEFAULT ARRAY['*']::text[] NOT NULL,
    "last_seen_at" timestamp,
    "revoked_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genie_hosts_pubkey_idx" ON "genie_hosts" ("pubkey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genie_hosts_active_idx" ON "genie_hosts" ("revoked_at");
