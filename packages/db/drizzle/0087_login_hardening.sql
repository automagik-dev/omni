-- Human login hardening (wish: omni-labs-distribution; review of the Better Auth login).
--
--   login_sessions.device_client_id   set only on the session Better Auth's device flow
--                                     hands a device; /api/v2/login/device-key accepts no
--                                     other kind of session (never a browser's)
--   login_users_one_owner             at most one row: an Omni has one owner, even when two
--                                     claims race past the application's own check
--
-- Journal `when` is 0085's + 3, for the same labs-first reason as 0086 (see its header).
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "login_sessions" ADD COLUMN IF NOT EXISTS "device_client_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "login_users_one_owner" ON "login_users" ((true));
