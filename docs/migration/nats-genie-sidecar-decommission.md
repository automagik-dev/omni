# Migration: Decommissioning `nats-reply-sidecar.mjs`

**Status:** Active as of automagik-dev/omni#361 fix
**Audience:** Operators running a `nats-genie` provider in production

## Why this sidecar existed

The `nats-reply-sidecar.mjs` script was an external subscriber on `omni.reply.>` that forwarded agent replies to `omni send` as a workaround for two bugs in the in-process `NatsGenieProvider`:

1. **WhatsApp replies silently lost.** The provider subscribed to `omni.reply.{instanceId}.*`. The single-token NATS wildcard `*` matches exactly one subject segment, but WhatsApp chat IDs contain dots (e.g. `5511999999999@s.whatsapp.net`), so the broker tokenized them as multiple segments and the subscription never matched. The sidecar used the recursive wildcard `omni.reply.>` and caught every reply.
2. **Missing session-reset propagation.** `NatsGenieProvider` did not implement `IAgentProvider.resetSession()`, so the dispatcher silently skipped publishing reset events for NATS providers.

Running both the sidecar and the in-process subscription at the same time caused duplicate deliveries: the same agent reply was sent to the user once by the sidecar and once by the in-process path.

## What changed

PR for [automagik-dev/omni#361](https://github.com/automagik-dev/omni/issues/361):

- `startReplySubscription()` now subscribes to `omni.reply.{instanceId}.>` (recursive wildcard). WhatsApp chat IDs are handled correctly in-process.
- `NatsGenieProvider.resetSession(sessionKey, chatId, instanceId)` publishes `{ action: 'kill' }` on `omni.session.reset.{instanceId}.{chatId}`. The dispatcher's existing `executeProviderSessionReset()` path now publishes reset events for NATS providers.

## Cross-repo dependency (READ BEFORE DEPLOY)

The session-reset publish above depends on the genie `omni-bridge` subscribing to `omni.session.reset.>`. That subscription is tracked in **[automagik-dev/genie#1089](https://github.com/automagik-dev/genie/issues/1089)**.

**Until genie#1089 ships and is deployed alongside your Omni upgrade, calling `resetSession()` on a NATS provider will publish to a subject with zero subscribers** — the reset intent is durable on the broker but no agent session is actually killed. User-facing behavior: Omni clears its internal session map but the agent's in-memory conversation state persists.

Reply delivery (the wildcard fix) is **not** dependent on the genie side and takes effect immediately upon deployment.

## Migration steps

1. **Confirm you are running the sidecar.** On your Omni host:
   ```bash
   pgrep -fa nats-reply-sidecar || echo "sidecar not running"
   ```
2. **Deploy the omni upgrade** containing this fix.
3. **Stop the sidecar *before* accepting traffic** on the upgraded omni process. If you leave both running, every reply will be delivered twice:
   ```bash
   # pm2
   pm2 stop nats-reply-sidecar
   pm2 delete nats-reply-sidecar

   # systemd
   sudo systemctl stop nats-reply-sidecar
   sudo systemctl disable nats-reply-sidecar

   # raw pkill (last resort)
   pkill -f nats-reply-sidecar.mjs
   ```
4. **Verify replies still flow.** Send a test WhatsApp message to an instance bound to a `nats-genie` provider. Expect exactly one reply.
5. **Monitor** `omni.reply.>` for a few minutes to confirm no messages are stranded:
   ```bash
   nats sub 'omni.reply.>'
   ```
   You should see each reply delivered to the subscription — the in-process provider handles it silently.

## Rollback

If the upgraded provider fails to deliver replies:

1. Revert the omni process to the previous version.
2. Re-start the sidecar with its original config.
3. File a bug referencing this runbook and [automagik-dev/omni#361](https://github.com/automagik-dev/omni/issues/361) with the failed subject and payload captured from `nats sub 'omni.reply.>'`.

## Why we didn't keep the sidecar as-is

Dual-path delivery is unsafe in production. Correlation IDs or seen-sets would have to be plumbed through two independent processes with their own NATS connections — complexity for zero value once the in-process path handles WhatsApp chat IDs correctly.
