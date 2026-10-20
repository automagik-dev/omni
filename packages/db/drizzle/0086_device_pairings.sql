-- Device pairing by code (wish: omni-labs-distribution, Group 2).
--
-- A desktop app or DSH plugin asks POST /api/v2/pair/start for a short code,
-- its owner sends that code over WhatsApp to the server's pairing instance,
-- and the device's next poll receives a freshly minted, scoped API key. One
-- row per attempt:
--
--   device_pairings  pending -> approved -> consumed (or cancelled; expiry is
--                    read from expires_at, never written)
--
-- Code and poll token are stored only as SHA-256 hex, and the key is minted at
-- the consuming poll, so the table never holds a secret. No tenant_id: pairing
-- is a pre-auth control-plane surface, off unless OMNI_PAIRING_ENABLED=true.
--
-- Journal `when` is 0085's + 1, not the usual + 100000000, on purpose: this
-- ships first on the `labs` branch and may be deployed before dev takes its own
-- next migration. The boot migrator applies only entries newer than the last
-- applied `when`, so a dev migration at the conventional 0085 + 100000000 still
-- runs on a database that already has this one. When labs merges into dev this
-- file is renumbered after dev's (the parallel-worktree rule); re-running it on
-- a database that has it is a no-op, since every statement is IF NOT EXISTS.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

CREATE TABLE IF NOT EXISTS "device_pairings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_name" varchar(80) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "poll_token_hash" varchar(64) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "instance_id" uuid NOT NULL,
  "client_ip" varchar(45),
  "approved_by" varchar(255),
  "approved_at" timestamp with time zone,
  "api_key_id" uuid,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "device_pairings_code_hash_idx"
  ON "device_pairings" ("code_hash");
CREATE INDEX IF NOT EXISTS "device_pairings_status_expires_idx"
  ON "device_pairings" ("status", "expires_at");
