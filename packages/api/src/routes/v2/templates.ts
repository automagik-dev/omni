/**
 * WhatsApp Cloud HSM template routes (Group 6 of whatsapp-cloud-channel wish).
 *
 * Mounted at /api/v2 — routes carry their own /instances/:id/whatsapp-templates
 * prefix so we land alongside other nested instance resources (routes,
 * automations, etc.).
 *
 * Scopes are enforced globally by middleware/scope-enforcer via SCOPE_MAP
 * entries (see packages/api/src/constants/scopes.ts).
 *
 * Pure-service module @omni/channel-whatsapp-cloud/src/templates.ts holds the
 * Graph API logic; this file only handles HTTP plumbing + instance access +
 * outbound dispatch.
 */

import { zValidator } from '@hono/zod-validator';
import {
  MetaWhatsAppClient,
  createTemplate as metaCreateTemplate,
  deleteTemplate as metaDeleteTemplate,
  listTemplatesFromMeta,
  syncTemplatesToDb,
  uploadHeaderMedia,
} from '@omni/channel-whatsapp-cloud';
import {
  MetaTemplateCategorySchema,
  MetaTemplateStatusSchema,
  WhatsAppTemplateComponentSchema,
} from '@omni/core/schemas';
import { whatsappTemplates } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';

const templatesRoutes = new Hono<{ Variables: AppVariables }>();

const instanceAccess = requireInstanceAccess((c) => c.req.param('id') ?? '');

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const templateIdParamSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
});

const templateNameParamSchema = z.object({
  id: z.string().uuid(),
  templateName: z.string().min(1),
});

const listQuerySchema = z.object({
  status: MetaTemplateStatusSchema.optional(),
  category: MetaTemplateCategorySchema.optional(),
  language: z.string().min(2).optional(),
  sync: z.coerce.boolean().optional(),
});

const createBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9_]+$/, 'Template name must be lowercase letters, digits, or underscores'),
  language: z.string().min(2).default('pt_BR'),
  category: MetaTemplateCategorySchema,
  components: z.array(WhatsAppTemplateComponentSchema).min(1),
  variableMapping: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

const sendTestBodySchema = z.object({
  to: z.string().min(1),
  variables: z.record(z.string(), z.string()).default({}),
});

const sendByNameBodySchema = z.object({
  to: z.string().min(1),
  language: z.string().min(2).default('pt_BR'),
  variables: z.record(z.string(), z.string()).default({}),
  headerMedia: z
    .object({
      type: z.enum(['image', 'video', 'document']),
      link: z.string().url().optional(),
      id: z.string().optional(),
      filename: z.string().optional(),
    })
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface InstanceMetaConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  appId?: string;
  apiVersion: string;
}

function jsonError(message: string, code = 'BAD_REQUEST', status = 400) {
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
  metaAppId?: string | null;
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
    appId: instance.metaAppId ?? undefined,
    apiVersion: instance.metaApiVersion ?? 'v25.0',
  };
}

function makeClient(cfg: InstanceMetaConfig): MetaWhatsAppClient {
  return new MetaWhatsAppClient(
    { accessToken: cfg.accessToken, phoneNumberId: cfg.phoneNumberId, apiVersion: cfg.apiVersion },
    cfg.wabaId,
  );
}

/**
 * Turn `{ "1": "John", "2": "Acme" }` into Meta's positional `parameters` body.
 * Variables are sorted by numeric key so order is deterministic.
 */
function variablesToBodyParameters(variables: Record<string, string>): string[] {
  return Object.entries(variables)
    .map(([k, v]) => [Number.parseInt(k, 10), v] as const)
    .filter(([n]) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /instances/:id/whatsapp-templates
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.get(
  '/instances/:id/whatsapp-templates',
  instanceAccess,
  zValidator('param', idParamSchema),
  zValidator('query', listQuerySchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const { status, category, language, sync } = c.req.valid('query');
    const services = c.get('services');
    const db = c.get('db');

    const instance = await services.instances.getById(instanceId);

    // Optional Meta sync before returning the local list.
    if (sync) {
      const cfg = readMetaConfig(instance);
      if (!cfg) {
        return c.json(jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED'), 400);
      }
      const client = makeClient(cfg);
      const metaTemplates = await listTemplatesFromMeta(client, cfg.wabaId);
      await syncTemplatesToDb(db, instanceId, cfg.wabaId, metaTemplates);
    }

    // Build query — instance scope is required; optional filters layer on top.
    const conditions = [eq(whatsappTemplates.instanceId, instanceId)];
    if (status) conditions.push(eq(whatsappTemplates.status, status));
    if (category) conditions.push(eq(whatsappTemplates.category, category));
    if (language) conditions.push(eq(whatsappTemplates.language, language));

    const rows = await db
      .select()
      .from(whatsappTemplates)
      .where(and(...conditions));

    return c.json({ items: rows, meta: { count: rows.length } });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /instances/:id/whatsapp-templates/:templateId
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.get(
  '/instances/:id/whatsapp-templates/:templateId',
  instanceAccess,
  zValidator('param', templateIdParamSchema),
  async (c) => {
    const { id: instanceId, templateId } = c.req.valid('param');
    const db = c.get('db');

    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.instanceId, instanceId)))
      .limit(1);

    if (!row) {
      return c.json(jsonError('Template not found', 'NOT_FOUND', 404), 404);
    }
    return c.json({ data: row });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-templates
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.post(
  '/instances/:id/whatsapp-templates',
  instanceAccess,
  zValidator('param', idParamSchema),
  zValidator('json', createBodySchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const body = c.req.valid('json');
    const services = c.get('services');
    const db = c.get('db');

    const instance = await services.instances.getById(instanceId);
    const cfg = readMetaConfig(instance);
    if (!cfg) {
      return c.json(jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED'), 400);
    }

    const client = makeClient(cfg);

    // 1) Submit to Meta.
    const result = await metaCreateTemplate(client, cfg.wabaId, {
      name: body.name,
      language: body.language,
      category: body.category,
      components: body.components,
    });

    // 2) Upsert local mirror (status starts PENDING; webhook will promote it).
    const now = new Date();
    const [existing] = await db
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.instanceId, instanceId),
          eq(whatsappTemplates.name, body.name),
          eq(whatsappTemplates.language, body.language),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(whatsappTemplates)
        .set({
          metaId: result.id,
          wabaId: cfg.wabaId,
          category: body.category,
          status: result.status,
          components: body.components as unknown[],
          variableMapping: body.variableMapping ?? null,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(eq(whatsappTemplates.id, existing.id));
      const [updated] = await db
        .select()
        .from(whatsappTemplates)
        .where(eq(whatsappTemplates.id, existing.id))
        .limit(1);
      return c.json({ data: updated }, 200);
    }

    const [inserted] = await db
      .insert(whatsappTemplates)
      .values({
        instanceId,
        metaId: result.id,
        wabaId: cfg.wabaId,
        name: body.name,
        language: body.language,
        category: body.category,
        status: result.status,
        components: body.components as unknown[],
        variableMapping: body.variableMapping ?? null,
      })
      .returning();
    return c.json({ data: inserted }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /instances/:id/whatsapp-templates/:templateId
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.delete(
  '/instances/:id/whatsapp-templates/:templateId',
  instanceAccess,
  zValidator('param', templateIdParamSchema),
  async (c) => {
    const { id: instanceId, templateId } = c.req.valid('param');
    const services = c.get('services');
    const db = c.get('db');

    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.instanceId, instanceId)))
      .limit(1);
    if (!row) {
      return c.json(jsonError('Template not found', 'NOT_FOUND', 404), 404);
    }

    const instance = await services.instances.getById(instanceId);
    const cfg = readMetaConfig(instance);
    if (!cfg) {
      return c.json(jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED'), 400);
    }

    const client = makeClient(cfg);
    await metaDeleteTemplate(client, cfg.wabaId, row.name, row.metaId ?? undefined);

    await db
      .update(whatsappTemplates)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(whatsappTemplates.id, row.id));

    return c.json({ success: true, templateId: row.id });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-templates/upload-header-media
// Multipart: field `file` carries the image/video/document bytes.
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.post(
  '/instances/:id/whatsapp-templates/upload-header-media',
  instanceAccess,
  zValidator('param', idParamSchema),
  async (c) => {
    const { id: instanceId } = c.req.valid('param');
    const services = c.get('services');

    const instance = await services.instances.getById(instanceId);
    const cfg = readMetaConfig(instance);
    if (!cfg) {
      return c.json(jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED'), 400);
    }
    if (!cfg.appId) {
      return c.json(
        jsonError(
          'Instance has no metaAppId — required for header media upload (Resumable Upload API)',
          'NOT_CONFIGURED',
        ),
        400,
      );
    }

    // Parse multipart body. Hono's parseBody returns string|File map.
    const form = (await c.req.parseBody()) as Record<string, string | File>;
    const fileField = form.file;
    if (!fileField || typeof fileField === 'string') {
      return c.json(jsonError("Multipart field 'file' is required", 'INVALID_INPUT'), 400);
    }
    const file = fileField as File;
    const bytes = await file.arrayBuffer();

    const { handle } = await uploadHeaderMedia(
      cfg.appId,
      cfg.accessToken,
      { bytes, mimeType: file.type || 'application/octet-stream', filename: file.name },
      cfg.apiVersion,
    );

    return c.json({ handle, filename: file.name, size: bytes.byteLength, mimeType: file.type });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-templates/:templateId/send-test
// Resolves the local template row, then sends to `to` using its name + lang.
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.post(
  '/instances/:id/whatsapp-templates/:templateId/send-test',
  instanceAccess,
  zValidator('param', templateIdParamSchema),
  zValidator('json', sendTestBodySchema),
  async (c) => {
    const { id: instanceId, templateId } = c.req.valid('param');
    const { to, variables } = c.req.valid('json');
    const services = c.get('services');
    const db = c.get('db');

    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.instanceId, instanceId)))
      .limit(1);
    if (!row) {
      return c.json(jsonError('Template not found', 'NOT_FOUND', 404), 404);
    }

    const instance = await services.instances.getById(instanceId);
    const cfg = readMetaConfig(instance);
    if (!cfg) {
      return c.json(jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED'), 400);
    }

    // Direct dispatch via client.sendMessage with a template payload.
    // NOTE: Group 3's `sendTemplate` sender exposes the exact same wire shape
    // via client.buildTemplatePayload — when the plugin's outbound dispatcher
    // exposes template sends through ChannelPlugin.sendMessage(), this route
    // should switch to that path so retry/observability are consistent. For
    // now we go straight to Graph API to avoid leaking Group 3 wiring assumptions.
    const client = makeClient(cfg);
    const bodyParameters = variablesToBodyParameters(variables);
    const template = client.buildTemplatePayload({
      name: row.name,
      language: row.language,
      bodyParameters: bodyParameters.length ? bodyParameters : undefined,
    });

    const res = await client.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template,
    });

    const wamid = res.messages?.[0]?.id;
    return c.json({ wamid, to, templateName: row.name, language: row.language });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /instances/:id/whatsapp-templates/:templateName/send
// Same as send-test but resolved by template NAME (retro-compat with TalkFlow).
// ─────────────────────────────────────────────────────────────────────────────

templatesRoutes.post(
  '/instances/:id/whatsapp-templates/:templateName/send',
  instanceAccess,
  zValidator('param', templateNameParamSchema),
  zValidator('json', sendByNameBodySchema),
  async (c) => {
    const { id: instanceId, templateName } = c.req.valid('param');
    const { to, language, variables, headerMedia } = c.req.valid('json');
    const services = c.get('services');

    const instance = await services.instances.getById(instanceId);
    const cfg = readMetaConfig(instance);
    if (!cfg) {
      return c.json(jsonError('Instance has no Meta credentials — connect first', 'NOT_CONFIGURED'), 400);
    }

    const client = makeClient(cfg);
    const bodyParameters = variablesToBodyParameters(variables);
    const template = client.buildTemplatePayload({
      name: templateName,
      language,
      bodyParameters: bodyParameters.length ? bodyParameters : undefined,
      headerMedia,
    });

    const res = await client.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template,
    });

    const wamid = res.messages?.[0]?.id;
    return c.json({ wamid, to, templateName, language });
  },
);

export { templatesRoutes };
