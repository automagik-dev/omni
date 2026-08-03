-- WhatsApp Flows data-endpoint encryption keys (whatsapp-flows feature).
--
-- One active RSA keypair per instance: the public key is registered with Meta
-- (POST /{phone_number_id}/whatsapp_business_encryption) and the private key
-- decrypts inbound flow data-exchange requests. `private_key_pem` is sealed
-- at rest via sealCredentialField when tenancy + master key are configured
-- (legacy plaintext otherwise — same codec as instance credential columns).
-- Rotation replaces the row (unique on instance_id).
--
-- Tenancy derives via instance_id (the whatsapp_templates precedent) — no
-- denormalized tenant_id column, so the table stays outside the RLS
-- tenant-table manifest by construction.
--
-- Hand-written following the 0044/0045 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent statements.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

CREATE TABLE IF NOT EXISTS "whatsapp_flow_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL,
  "private_key_pem" text NOT NULL,
  "public_key_pem" text NOT NULL,
  "uploaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "whatsapp_flow_keys"
    ADD CONSTRAINT "whatsapp_flow_keys_instance_id_instances_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_wa_flow_keys_instance"
  ON "whatsapp_flow_keys" ("instance_id");
