/**
 * Channel capability matrix and deployment-wide Meta webhook setup.
 *
 * Declarative counterpart to `GET /events/types`: what each loaded channel
 * plugin CAN publish, read from `capabilities.events` in the registry. The
 * declarations are held to the code by channel-sdk's event-capabilities test.
 */

import { BlockList, isIP } from 'node:net';
import { Hono } from 'hono';
import { requireAnyScope } from '../../middleware/auth';
import { isLockActive } from '../../middleware/scope-enforcer';
import { MetaWebhookSetupSchema } from '../../schemas/openapi/channels';
import type { ChannelCapabilitiesMatrix } from '../../schemas/openapi/channels';
import type { AppVariables } from '../../types';

const channelsRoutes = new Hono<{ Variables: AppVariables }>();

// Check parsed literal addresses without resolving DNS. BlockList also applies
// IPv4 subnets to their IPv4-mapped IPv6 representations.
const nonPublicCallbackIps = new BlockList();
for (const [network, prefix, family] of [
  ['0.0.0.0', 32, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
] as const)
  nonPublicCallbackIps.addSubnet(network, prefix, family);

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
    const hostname = url.hostname.replace(/\.$/, '');
    const address = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(address);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/^(localhost|.*\.(localhost|local)|127\..*)$/i.test(hostname) &&
      (!family || !nonPublicCallbackIps.check(address, family === 4 ? 'ipv4' : 'ipv6'))
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
