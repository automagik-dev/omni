-- Backfill: chats that auto-promoted to a hard terminal under the old
-- `redirected_sac` escalation rule (escalationThreshold=2 over 7 days) get
-- `chats.settings.closed` flipped back to false. Companion to the config
-- fix in `packages/api/src/routes/v2/_close-contact-config.ts` which drops
-- the escalation going forward — an active customer ending every
-- conversation with a support-channel redirect is normal account activity,
-- not a signal worth silencing the reactive agent over.
--
-- `closeUntil`, `closeOutcome`, and `close_contact_logs` are deliberately
-- left intact so reporting and downstream BI consumers see no change.
-- Hard terminals from `won`/`lost` outcomes are not touched.
--
-- Hand-written (not `drizzle-kit generate`) because this is a JSONB merge
-- with a filter predicate that `drizzle-kit` cannot emit directly.
--
-- Performance note: there is no index on `chats.settings->>'closed'` or
-- `closeOutcome`, so the predicate is evaluated via a sequential scan.
-- The expected blast radius is small (only chats that previously hit
-- `redirected_sac` twice within a 7-day window), but on very large
-- `chats` tables a single UPDATE would still hold row locks for the
-- entire matched set in one transaction. Batched into 1000-row chunks so
-- each iteration acquires a bounded number of row locks; once a chat is
-- flipped to `closed: false` it stops matching the predicate, so
-- subsequent iterations naturally narrow.

DO $$
DECLARE
  rows_updated INT;
BEGIN
  LOOP
    WITH candidates AS (
      SELECT "id"
      FROM "chats"
      WHERE ("settings"->>'closed')::boolean IS TRUE
        AND "settings"->>'closeOutcome' = 'redirected_sac'
      LIMIT 1000
    )
    UPDATE "chats" AS c
    SET "settings" = c."settings" - 'closed' || jsonb_build_object('closed', false)
    FROM candidates
    WHERE c."id" = candidates."id";

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END
$$;
