-- Config-mutation audit log (issue #1152).
--
-- api_key_audit_logs records method/path/status only and is dominated by
-- polling GETs. tenant_audit_logs needs a tenant FK + credential uuid, so it
-- does not fit single-tenant legacy keys. This table holds one row per
-- POST/PATCH/PUT/DELETE on config resources (instances, agents, providers,
-- routes, automations, keys, settings) with actor, request id, client IP,
-- user agent, target, and before/after of changed fields. Secret-bearing
-- values are stored only as sha256 prefix fingerprints.
--
-- Retention: reads are never written here; keep ~180d.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

CREATE TABLE IF NOT EXISTS "config_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "api_key_id" varchar(100),
  "api_key_name" varchar(255),
  "actor" varchar(255),
  "request_id" varchar(100),
  "ip_address" varchar(64),
  "user_agent" text,
  "method" varchar(10) NOT NULL,
  "path" varchar(500) NOT NULL,
  "status_code" integer NOT NULL,
  "action" varchar(100) NOT NULL,
  "target_type" varchar(50) NOT NULL,
  "target_id" varchar(255),
  "changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
  "changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "config_audit_logs_target_idx"
  ON "config_audit_logs" ("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "config_audit_logs_actor_idx"
  ON "config_audit_logs" ("actor");
CREATE INDEX IF NOT EXISTS "config_audit_logs_created_at_idx"
  ON "config_audit_logs" ("created_at");
