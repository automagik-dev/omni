-- Evolution credentials follow the tenant-bound sealing and write-only API contract.
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "evolution_config" jsonb;
