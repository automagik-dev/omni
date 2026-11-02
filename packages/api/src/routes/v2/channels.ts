/**
 * Channel capability matrix and deployment-wide Meta webhook setup.
 *
 * Declarative counterpart to `GET /events/types`: what each loaded channel
 * plugin CAN publish, read from `capabilities.events` in the registry. The
 * declarations are held to the code by channel-sdk's event-capabilities test.
 */

import { Hono } from 'hono';
import { requireAnyScope } from '../../middleware/auth';
import { isLockActive } from '../../middleware/scope-enforcer';
import { MetaWebhookSetupSchema } from '../../schemas/openapi/channels';
import type { ChannelCapabilitiesMatrix } from '../../schemas/openapi/channels';
import type { AppVariables } from '../../types';

const channelsRoutes = new Hono<{ Variables: AppVariables }>();

// Also set before auth in app.ts, so refusals cannot be cached either.
channelsRoutes.use('/whatsapp-business/webhook-setup', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

/** GET /channels/whatsapp-business/webhook-setup — deployment-wide secret, not instance config. */
channelsRoutes.get('/whatsapp-business/webhook-setup', requireAnyScope(['settings:write']), async (c) => {
  const key = c.get('apiKey');
  if (
    !key ||
    c.get('authContext') ||
    key.instanceIds !== null ||
    (['instanceAllowlist', 'chatAllowlist', 'outboundRecipientAllowlist'] as const).some((lock) =>
      isLockActive(key.profile, lock, key[lock] ?? []),
    )
  ) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'An unlocked global settings administrator is required' } },
      403,
    );
  }

  // Same settings-row-first, env-fallback precedence as server OAuth configuration.
  const raw = await c.get('services').settings.getString('server.public_url', 'OMNI_PUBLIC_URL');
  let callbackUrl: string | null = null;
  try {
    const url = new URL(raw?.trim() ?? '');
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/^(localhost|.*\.localhost|127\..*|0\.0\.0\.0|\[::1\]|\[::\])$/i.test(url.hostname.replace(/\.$/, ''))
    ) {
      callbackUrl = `${url.href.replace(/\/+$/, '')}/api/v2/channels/whatsapp-business/webhook`;
    }
  } catch {
    /* An unset or unusable public URL is configuration, never the request host. */
  }
  const verifyToken = process.env.META_VERIFY_TOKEN || null;
  return c.json({
    data: MetaWebhookSetupSchema.parse({
      callbackUrl,
      verifyToken,
      appSecretConfigured: Boolean(process.env.META_APP_SECRET),
      state: !callbackUrl ? 'public_url_missing' : !verifyToken ? 'verify_token_missing' : 'ready',
    }),
  });
});

/**
 * GET /channels/capabilities - Event vocabulary and guarantees per loaded channel
 */
channelsRoutes.get('/capabilities', (c) => {
  const plugins = c.get('channelRegistry')?.getAll() ?? [];
  const items: ChannelCapabilitiesMatrix['items'] = plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    emits: plugin.capabilities.events ? [...plugin.capabilities.events.emits] : null,
    edits: plugin.capabilities.events?.edits ?? 'unknown',
    deletes: plugin.capabilities.events?.deletes ?? 'unknown',
    idempotency: plugin.capabilities.events?.idempotency ?? 'unknown',
  }));
  return c.json({ items });
});

export { channelsRoutes };
