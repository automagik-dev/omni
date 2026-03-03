-- PR #164 Review Fixes — dev-only documentation migration
-- This migration contains no schema changes.
-- It documents decisions made during PR #164 review for the dev database.

-- B1: Cost backfill — dev-only DB, no production data to migrate.
-- If production data existed, run:
-- BEGIN;
-- UPDATE batch_jobs SET total_cost_usd = total_cost_usd / 100 WHERE total_cost_usd IS NOT NULL AND total_cost_usd > 0;
-- UPDATE media_content SET cost_usd = cost_usd / 100 WHERE cost_usd IS NOT NULL AND cost_usd > 0;
-- COMMIT;

-- B9: Migration 0005 used partial UUID regex '^[0-9a-f]{8}-' (case-sensitive, prefix-only).
-- Dev-only: no production deployment. NULLed agent_id values accepted as dev data loss.
-- No recovery query needed (DEC-6).

-- B2: Migration 0005 dropped agent_fk_id column without backfill.
-- Dev-only: no production agent_fk_id data existed. Accepted as dev data loss.

SELECT 1;
