/**
 * Harness channel driving/inspection routes (issue #953).
 *
 * The E2E test surface for agents that answer through Omni:
 *   POST   /channels/harness/:instanceId/say         — drive an inbound turn
 *   GET    /channels/harness/:instanceId/transcript  — verbatim per-chat capture
 *   POST   /channels/harness/:instanceId/tap         — simulate a component tap
 *   DELETE /channels/harness/:instanceId/transcript  — reset a chat / instance
 *
 * Unlike the public channel webhooks these are AUTH-REQUIRED (mounted inside
 * protectedApp): they read tenant conversation data and inject billed agent
 * dispatches, so they carry instance access checks like any other v2 route.
 *
 * The plugin is duck-typed (the slack.ts precedent) — a runtime import of
 * @omni/channel-harness would register the plugin as a module side effect and
 * make the loader's "pre-registered" check skip discovery of every other
 * channel. Type-only imports keep the route schemas structurally pinned to
 * the plugin's request/response types without that hazard.
 */

import { zValidator } from '@hono/zod-validator';
import type {
  HarnessInboundEntry,
  HarnessSayRequest,
  HarnessTapRequest,
  HarnessTranscript,
} from '@omni/channel-harness';
import { ERROR_CODES, OmniError } from '@omni/core';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';

export const harnessRoutes = new Hono<{ Variables: AppVariables }>();

const instanceAccess = requireInstanceAccess((c) => c.req.param('instanceId') ?? '');

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — mirror @omni/channel-harness types; the handler passes the parsed
// body straight into the typed plugin methods, so any drift fails typecheck.
// ─────────────────────────────────────────────────────────────────────────────

const sayBodySchema = z
  .object({
    chatId: z.string().min(1).max(256),
    text: z.string().min(1).max(65536),
    from: z.string().min(1).max(256).optional(),
    senderName: z.string().min(1).max(256).optional(),
  })
  .strict();

const tapBodySchema = z
  .object({
    chatId: z.string().min(1).max(256),
    option: z.union([z.number().int().min(1), z.string().min(1).max(256)]),
    messageSeq: z.number().int().min(1).optional(),
  })
  .strict();

const transcriptQuerySchema = z.object({
  chatId: z.string().min(1).max(256),
});

const resetQuerySchema = z.object({
  chatId: z.string().min(1).max(256).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin resolution
// ─────────────────────────────────────────────────────────────────────────────

/** The driving surface of HarnessChannelPlugin, duck-typed (slack precedent). */
interface HarnessDriverPlugin {
  say?: (instanceId: string, request: HarnessSayRequest) => Promise<HarnessInboundEntry>;
  tap?: (instanceId: string, request: HarnessTapRequest) => Promise<HarnessInboundEntry>;
  getTranscript?: (instanceId: string, chatId: string) => HarnessTranscript;
  resetTranscript?: (instanceId: string, chatId?: string) => void;
}

/** Resolve the harness plugin, refusing early when the instance is not a harness. */
async function getHarnessPlugin(
  c: Context<{ Variables: AppVariables }>,
  instanceId: string,
): Promise<HarnessDriverPlugin> {
  const services = c.get('services');
  const instance = await services.instances.getById(instanceId);

  if (instance.channel !== 'harness') {
    // VALIDATION (→ 400): CAPABILITY_NOT_SUPPORTED has no ERROR_STATUS_MAP entry and would 500.
    throw new OmniError({
      code: ERROR_CODES.VALIDATION,
      message: `Instance ${instanceId} is a ${instance.channel} instance; these endpoints are harness-only`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  const registry = c.get('channelRegistry');
  const plugin = registry?.get('harness') as HarnessDriverPlugin | undefined;
  if (!plugin) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Harness plugin not registered',
      recoverable: false,
    });
  }
  return plugin;
}

function requireMethod<K extends keyof HarnessDriverPlugin>(
  plugin: HarnessDriverPlugin,
  method: K,
): NonNullable<HarnessDriverPlugin[K]> {
  const fn = plugin[method];
  if (typeof fn !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Harness plugin does not implement ${method}`,
      recoverable: false,
    });
  }
  return fn.bind(plugin) as NonNullable<HarnessDriverPlugin[K]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /channels/harness/:instanceId/say — inject an inbound message.
 * Emits message.received on the instance exactly as a real channel webhook
 * would; the dispatcher and agent then run the production path.
 */
harnessRoutes.post('/:instanceId/say', instanceAccess, zValidator('json', sayBodySchema), async (c) => {
  const instanceId = c.req.param('instanceId');
  const plugin = await getHarnessPlugin(c, instanceId);
  const entry = await requireMethod(plugin, 'say')(instanceId, c.req.valid('json'));
  return c.json({ data: entry }, 201);
});

/**
 * POST /channels/harness/:instanceId/tap — simulate tapping a button/list row
 * of a component the agent actually sent. The injected inbound carries the
 * option's title as text (the whatsapp-business/hermes parser precedent).
 */
harnessRoutes.post('/:instanceId/tap', instanceAccess, zValidator('json', tapBodySchema), async (c) => {
  const instanceId = c.req.param('instanceId');
  const plugin = await getHarnessPlugin(c, instanceId);
  const entry = await requireMethod(plugin, 'tap')(instanceId, c.req.valid('json'));
  return c.json({ data: entry }, 201);
});

/**
 * GET /channels/harness/:instanceId/transcript?chatId=… — the ordered,
 * verbatim capture of one chat plus the instance's capability profile.
 */
harnessRoutes.get('/:instanceId/transcript', instanceAccess, zValidator('query', transcriptQuerySchema), async (c) => {
  const instanceId = c.req.param('instanceId');
  const plugin = await getHarnessPlugin(c, instanceId);
  const transcript = requireMethod(plugin, 'getTranscript')(instanceId, c.req.valid('query').chatId);
  return c.json({ data: transcript });
});

/**
 * DELETE /channels/harness/:instanceId/transcript?chatId=… — reset one chat's
 * transcript, or every transcript of the instance when chatId is omitted.
 */
harnessRoutes.delete('/:instanceId/transcript', instanceAccess, zValidator('query', resetQuerySchema), async (c) => {
  const instanceId = c.req.param('instanceId');
  const plugin = await getHarnessPlugin(c, instanceId);
  const { chatId } = c.req.valid('query');
  requireMethod(plugin, 'resetTranscript')(instanceId, chatId);
  return c.json({ data: { reset: true, ...(chatId !== undefined ? { chatId } : { scope: 'instance' }) } });
});
