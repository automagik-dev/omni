/**
 * WhatsApp Cloud Flows routes (whatsapp-cloud-revival wish).
 *
 * Mounted at /api/v2 — routes carry their own /instances/:id/whatsapp-flows
 * prefix so we land alongside other nested instance resources (mirrors
 * routes/v2/templates.ts).
 *
 * Scopes are enforced globally by middleware/scope-enforcer via SCOPE_MAP
 * entries (see packages/api/src/constants/scopes.ts).
 *
 * Flow management (list/create/publish/preview) hits Graph API directly via
 * `MetaWhatsAppClient`; the send route goes through the channel plugin's
 * `sendMessage` dispatch (`content.type='flow'` + `metadata.flow` descriptor)
 * so retry/observability stay consistent with other outbound sends.
 */

import { zValidator } from '@hono/zod-validator';
import { MetaWhatsAppClient } from '@omni/channel-whatsapp-cloud';
import { createLogger } from '@omni/core';
import { WhatsAppFlowSendSchema } from '@omni/core/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { ensureWhatsAppCloud } from './whatsapp-cloud';

const log = createLogger('routes:whatsapp-flows');

const whatsappFlowsRoutes = new Hono<{ Variables: AppVariables }>();

const instanceAccess = requireInstanceAccess((c) => c.req.param('id') ?? '');

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const flowIdParamSchema = z.object({
  id: z.string().uuid(),
  flowId: z.string().min(1),
});

/** Meta's fixed flow category set. */
const FlowCategorySchema = z.enum([
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'LEAD_GENERATION',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
]);

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  categories: z.array(FlowCategorySchema).min(1),
  /** Stringified Flow JSON (screens/layout definition). */
  flowJson: z.string().min(1).optional(),
  /** Publish immediately after creation (requires valid flowJson). */
  publish: z.boolean().optional(),
});

const sendBodySchema = WhatsAppFlowSendSchema.and(
  z.object({
    to: z.string().min(1),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface InstanceMetaConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  apiVersion: string;
}

function jsonError(message: string, code = 'BAD_REQUEST') {
  return { error: { code, message } } as const;
}

/**
 * Pull the Meta credentials off the instance row. Returns null if any required
 * field is missing — callers should respond 400 in that case.
 */
function readMetaConfig(instance: {
  metaAccessToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaWabaId?: string | null;
  metaApiVersion?: string | null;
}): InstanceMetaConfig | null {
  const accessToken = instance.metaAccessToken ?? null;
  const phoneNumberId = instance.metaPhoneNumberId ?? null;
  const wabaId = instance.metaWabaId ?? null;
  if (!accessToken || !phoneNumberId || !wabaId) return null;
  return {
    accessToken,
    phoneNumberId,
    wabaId,
    apiVersion: instance.metaApiVersion ?? 'v25.0',
  };
}

type FlowsClientResolution =
  | { ok: true; client: MetaWhatsAppClient }
  | { ok: false; payload: { error: { code: string; message: string } } };

/**
 * Resolve the instance, enforce the whatsapp-cloud channel guard, and build a
 * WABA-scoped Graph API client. Any `ok: false` result maps to a 400 response.
 */
async function resolveFlowsClient(
  services: AppVariables['services'],
  instanceId: string,
): Promise<FlowsClientResolution> {
  const instance = await services.instances.getById(instanceId);
  const guard = ensureWhatsAppCloud(instance);
  if (!guard.ok) return guard;

  const cfg = readMetaConfig(instance);
  if (!cfg) {
    return { ok: false, payload: jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED') };
  }
  const client = new MetaWhatsAppClient(
    { accessToken: cfg.accessToken, phoneNumberId: cfg.phoneNumberId, apiVersion: cfg.apiVersion },
    cfg.wabaId,
  );
  return { ok: true, client };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /instances/:id/whatsapp-flows — list flows from Meta
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.get(
  '/instances/:id/whatsapp-flows',
  instanceAccess,
  zValidator('param', idParamSchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const { data } = await resolved.client.listFlows();
    const items = data.map((flow) => ({
      id: flow.id,
      name: flow.name,
      status: flow.status,
      categories: flow.categories,
    }));
    return c.json({ items, meta: { count: items.length } });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-flows — create a flow (optionally publish)
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.post(
  '/instances/:id/whatsapp-flows',
  instanceAccess,
  zValidator('param', idParamSchema),
  zValidator('json', createBodySchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const body = c.req.valid('json');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const result = await resolved.client.createFlow({
      name: body.name,
      categories: body.categories,
      flowJson: body.flowJson,
      publish: body.publish,
    });
    return c.json({ data: { id: result.id } }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-flows/:flowId/publish
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.post(
  '/instances/:id/whatsapp-flows/:flowId/publish',
  instanceAccess,
  zValidator('param', flowIdParamSchema),
  async (c) => {
    const { id: instanceId, flowId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const result = await resolved.client.publishFlow(flowId);
    return c.json({ success: result.success, flowId });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /instances/:id/whatsapp-flows/:flowId/preview
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.get(
  '/instances/:id/whatsapp-flows/:flowId/preview',
  instanceAccess,
  zValidator('param', flowIdParamSchema),
  async (c) => {
    const { id: instanceId, flowId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const result = await resolved.client.getFlowPreview(flowId);
    if (!result.preview) {
      return c.json(jsonError('Flow has no preview available', 'NOT_FOUND'), 404);
    }
    return c.json({ previewUrl: result.preview.preview_url, expiresAt: result.preview.expires_at });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-flows/send — send a flow message via the plugin
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.post(
  '/instances/:id/whatsapp-flows/send',
  instanceAccess,
  zValidator('param', idParamSchema),
  zValidator('json', sendBodySchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const { to, ...flow } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(instanceId);
    const guard = ensureWhatsAppCloud(instance);
    if (!guard.ok) return c.json(guard.payload, 400);

    const plugin = channelRegistry?.get('whatsapp-cloud');
    if (!plugin) {
      return c.json(jsonError('whatsapp-cloud plugin not registered', 'PLUGIN_NOT_FOUND'), 500);
    }

    // Generate the correlation token here so it can be returned to the caller
    // — the nfm_reply webhook echoes it back verbatim.
    const flowToken = flow.flowToken ?? crypto.randomUUID();

    const result = await plugin.sendMessage(instanceId, {
      to,
      content: { type: 'flow', text: flow.bodyText },
      metadata: { flow: { ...flow, flowToken } },
    });

    if (!result.success) {
      log.error('flow send failed', { instanceId, to, error: result.error, errorCode: result.errorCode });
      return c.json(jsonError(result.error ?? 'Flow send failed', result.errorCode ?? 'SEND_FAILED'), 500);
    }

    return c.json({ messageId: result.messageId, flowToken }, 201);
  },
);

export { whatsappFlowsRoutes };
