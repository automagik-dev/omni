-- Add Z-API channel configuration for the local Kelvin provider integration.
-- Credentials follow the existing tenant sealing and write-only API contract.
-- Hand-written following the additive, idempotent migration precedent.
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "zapi_config" jsonb;
