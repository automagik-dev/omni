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
import { MetaWhatsAppClient, buildFlowToken, generateFlowKeyPair } from '@omni/channel-whatsapp-business';
import { createLogger } from '@omni/core';
import { WhatsAppFlowSendSchema, validateFlowJson } from '@omni/core/schemas';
import { whatsappFlowKeys } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireInstanceAccess } from '../../middleware/auth';
import { sealCredentialField } from '../../tenancy/sealed-credentials';
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
  /**
   * Endpoint-backed (data_exchange) flow: the server registers this omni
   * install's public flows-data URL as the flow's `endpoint_uri`. Requires
   * META_FLOWS_PUBLIC_BASE_URL and a Flow JSON with data_api_version '3.0'.
   */
  dynamic: z.boolean().optional(),
});

const updateBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    categories: z.array(FlowCategorySchema).min(1).optional(),
    /** Replaces the flow's screens (POST /{flow_id}/assets). */
    flowJson: z.string().min(1).optional(),
    /** Re-point (or newly point) the flow at this install's data endpoint. */
    dynamic: z.boolean().optional(),
  })
  .refine((v) => v.name || v.categories || v.flowJson || v.dynamic !== undefined, {
    message: 'Provide at least one of name, categories, flowJson, dynamic',
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
  | { ok: true; client: MetaWhatsAppClient; instance: { id: string; tenantId: string | null } }
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
  return { ok: true, client, instance: { id: instance.id, tenantId: instance.tenantId ?? null } };
}

/**
 * Public flows-data URL for `instanceId` — becomes the flow's `endpoint_uri`
 * for dynamic flows. Null when META_FLOWS_PUBLIC_BASE_URL is unset (dynamic
 * flows are rejected with a clear error instead of registering a dead URL).
 */
function flowsDataEndpointUri(instanceId: string): string | null {
  const base = process.env.META_FLOWS_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/api/v2/channels/whatsapp-cloud/flows/data/${instanceId}`;
}

/** 422 payload for local Flow JSON validation failures (pre-Meta feedback). */
function flowJsonInvalid(issues: ReturnType<typeof validateFlowJson>['issues']) {
  return {
    error: {
      code: 'INVALID_FLOW_JSON',
      message: 'Flow JSON failed local validation (checked before contacting Meta)',
    },
    issues,
  } as const;
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

    let endpointUri: string | undefined;
    if (body.dynamic) {
      const uri = flowsDataEndpointUri(instanceId);
      if (!uri) {
        return c.json(
          jsonError('dynamic flows require META_FLOWS_PUBLIC_BASE_URL to be configured', 'NOT_CONFIGURED'),
          400,
        );
      }
      endpointUri = uri;
    }

    // Local validation catches the silent killers (data_api_version without an
    // endpoint, RichText placement) before any Graph API round-trip.
    if (body.flowJson) {
      const local = validateFlowJson(body.flowJson, { dynamic: body.dynamic });
      if (!local.valid) return c.json(flowJsonInvalid(local.issues), 422);
    }

    const result = await resolved.client.createFlow({
      name: body.name,
      categories: body.categories,
      flowJson: body.flowJson,
      publish: body.publish,
      endpointUri,
    });
    return c.json(
      {
        data: {
          id: result.id,
          endpointUri: endpointUri ?? null,
          // Meta-side validation errors — a flow can be created and still be unopenable.
          validationErrors: result.validation_errors ?? [],
        },
      },
      201,
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Data-endpoint encryption keys — registered BEFORE the :flowId routes so
// the literal 'keys' segment never matches as a flow id.
// ─────────────────────────────────────────────────────────────────────────────

// POST /instances/:id/whatsapp-flows/keys — generate + register (or rotate)
whatsappFlowsRoutes.post(
  '/instances/:id/whatsapp-flows/keys',
  instanceAccess,
  zValidator('param', idParamSchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const { privateKeyPem, publicKeyPem } = await generateFlowKeyPair();
    await resolved.client.uploadBusinessPublicKey(publicKeyPem);

    // Sealed under the owning instance's tenant — the public data route
    // unseals with instance.tenantId, so the pair stays symmetric.
    const sealedPrivateKey = sealCredentialField(resolved.instance.tenantId, privateKeyPem);
    const now = new Date();
    const db = c.get('db');
    await db
      .insert(whatsappFlowKeys)
      .values({
        instanceId,
        privateKeyPem: sealedPrivateKey,
        publicKeyPem,
        uploadedAt: now,
      })
      .onConflictDoUpdate({
        target: whatsappFlowKeys.instanceId,
        set: {
          privateKeyPem: sealedPrivateKey,
          publicKeyPem,
          uploadedAt: now,
          updatedAt: now,
        },
      });

    const status = await resolved.client.getBusinessPublicKey().catch(() => null);
    log.info('flow encryption key registered', { instanceId });
    return c.json(
      {
        data: {
          uploaded: true,
          signatureStatus: status?.business_public_key_signature_status ?? null,
          endpointUri: flowsDataEndpointUri(instanceId),
        },
      },
      201,
    );
  },
);

// GET /instances/:id/whatsapp-flows/keys — local presence + Meta signature status
whatsappFlowsRoutes.get(
  '/instances/:id/whatsapp-flows/keys',
  instanceAccess,
  zValidator('param', idParamSchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const db = c.get('db');
    const [keyRow] = await db
      .select({ uploadedAt: whatsappFlowKeys.uploadedAt, createdAt: whatsappFlowKeys.createdAt })
      .from(whatsappFlowKeys)
      .where(eq(whatsappFlowKeys.instanceId, instanceId))
      .limit(1);

    const remote = await resolved.client.getBusinessPublicKey().catch(() => null);
    return c.json({
      data: {
        hasLocalKey: Boolean(keyRow),
        uploadedAt: keyRow?.uploadedAt ?? null,
        // MISMATCH → Meta encrypts with a key we no longer hold → 421 loop; rotate via POST.
        signatureStatus: remote?.business_public_key_signature_status ?? null,
        endpointUri: flowsDataEndpointUri(instanceId),
      },
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /instances/:id/whatsapp-flows/:flowId — status + validation + endpoint
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.get(
  '/instances/:id/whatsapp-flows/:flowId',
  instanceAccess,
  zValidator('param', flowIdParamSchema),
  async (c) => {
    const { id: instanceId, flowId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const flow = await resolved.client.getFlow(flowId);
    return c.json({
      data: {
        id: flow.id,
        name: flow.name,
        status: flow.status,
        categories: flow.categories,
        validationErrors: flow.validation_errors ?? [],
        endpointUri: flow.endpoint_uri ?? null,
        preview: flow.preview ?? null,
      },
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /instances/:id/whatsapp-flows/:flowId — update screens and/or properties
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.put(
  '/instances/:id/whatsapp-flows/:flowId',
  instanceAccess,
  zValidator('param', flowIdParamSchema),
  zValidator('json', updateBodySchema),
  async (c) => {
    const { id: instanceId, flowId } = c.req.valid('param');
    const body = c.req.valid('json');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    let endpointUri: string | undefined;
    if (body.dynamic) {
      const uri = flowsDataEndpointUri(instanceId);
      if (!uri) {
        return c.json(
          jsonError('dynamic flows require META_FLOWS_PUBLIC_BASE_URL to be configured', 'NOT_CONFIGURED'),
          400,
        );
      }
      endpointUri = uri;
    }

    if (body.flowJson) {
      const local = validateFlowJson(body.flowJson, { dynamic: body.dynamic });
      if (!local.valid) return c.json(flowJsonInvalid(local.issues), 422);
    }

    if (body.name || body.categories || endpointUri) {
      await resolved.client.updateFlowMetadata(flowId, {
        name: body.name,
        categories: body.categories,
        endpointUri,
      });
    }

    let validationErrors: unknown[] = [];
    if (body.flowJson) {
      const result = await resolved.client.updateFlowAssets(flowId, body.flowJson);
      validationErrors = result.validation_errors ?? [];
    }

    return c.json({ data: { id: flowId, endpointUri: endpointUri ?? null, validationErrors } });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /instances/:id/whatsapp-flows/:flowId — draft-only delete
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.delete(
  '/instances/:id/whatsapp-flows/:flowId',
  instanceAccess,
  zValidator('param', flowIdParamSchema),
  async (c) => {
    const { id: instanceId, flowId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const result = await resolved.client.deleteFlow(flowId);
    return c.json({ success: result.success, flowId });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-flows/:flowId/deprecate — retire a published flow
// ─────────────────────────────────────────────────────────────────────────────

whatsappFlowsRoutes.post(
  '/instances/:id/whatsapp-flows/:flowId/deprecate',
  instanceAccess,
  zValidator('param', flowIdParamSchema),
  async (c) => {
    const { id: instanceId, flowId } = c.req.valid('param');
    const resolved = await resolveFlowsClient(c.get('services'), instanceId);
    if (!resolved.ok) return c.json(resolved.payload, 400);

    const result = await resolved.client.deprecateFlow(flowId);
    return c.json({ success: result.success, flowId });
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
    // — the nfm_reply webhook echoes it back verbatim. Structured
    // (`omni.<flowRef>.<uuid>`) so the data-exchange endpoint can recover
    // which flow it is serving; caller-supplied tokens pass through opaque.
    const flowToken = flow.flowToken ?? buildFlowToken(flow.flowId ?? flow.flowName ?? 'unknown');

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
