-- WhatsApp Business (Meta Cloud API) — Meta-compatible provider settings.
--
-- Adds four nullable instance columns the `@omni/channel-whatsapp-business`
-- plugin reads on connect, so one instance can run through a provider that
-- mirrors the Cloud API (first: Kapso) instead of Meta directly:
--   * meta_api_base_url    — provider API base URL, version included
--                            (e.g. https://api.kapso.ai/meta/whatsapp/v24.0)
--   * meta_auth_mode       — 'bearer' (Meta) | 'x-api-key' (provider key header)
--   * meta_webhook_secret  — secret the provider signs forwarded webhooks with;
--                            plain text like meta_access_token
--   * meta_signature_mode  — 'x-hub-signature-256' (Meta, META_APP_SECRET) |
--                            'x-webhook-signature' (provider, the secret above)
-- All NULL keeps an instance Meta direct, exactly as before. Refs #1661.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent,
-- no rewrite: ADD COLUMN with no default does not rewrite the table).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single batch, idempotent statements.

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "meta_api_base_url" text;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "meta_auth_mode" varchar(16);
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "meta_webhook_secret" text;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "meta_signature_mode" varchar(32);
