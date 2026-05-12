/**
 * Meta WhatsApp Cloud — HSM template service.
 *
 * Pure service module (no Hono / DI):
 *   - CRUD against the Graph API for `/{waba_id}/message_templates`
 *   - Resumable upload for header media (returns the `h:...` handle the template
 *     create payload needs in `example.header_handle`)
 *   - Sync between Graph API state and the local `whatsapp_templates` row
 *   - Template lifecycle webhook handler (`message_template_status_update`)
 *
 * Reference (TalkFlow port):
 *   talkflow_backend/src/integrations/meta_template_service.py
 *   talkflow_backend/src/api/meta_template_routes.py
 *
 * Graph API reference:
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 */

import type { Database, NewWhatsappTemplate, WhatsappTemplate } from '@omni/db';
import { whatsappTemplates } from '@omni/db';
import type {
  MetaTemplateCategory,
  MetaTemplateStatus,
  WhatsAppTemplateComponent,
} from '@omni/core/types';
import type { MetaTemplateStatusUpdate } from '@omni/core/schemas';
import { and, eq, inArray, or } from 'drizzle-orm';

import type { MetaWhatsAppClient } from './client';
import type { WhatsAppCloudPlugin } from './plugin';
import { MetaApiError, MetaErrorCode, mapHttpStatusToMetaError } from './utils/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One template as returned by Graph API:
 *   GET /{waba_id}/message_templates
 *   GET /{template_id}
 */
export interface MetaTemplateRecord {
  id: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  status: MetaTemplateStatus;
  components?: WhatsAppTemplateComponent[];
  rejected_reason?: string;
  quality_score?: { score?: string; date?: number };
}

/** Paginated list envelope returned by Graph API. */
interface MetaTemplateListPage {
  data: MetaTemplateRecord[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: MetaTemplateCategory;
  components: WhatsAppTemplateComponent[];
}

export interface CreateTemplateResult {
  id: string;
  status: MetaTemplateStatus;
}

export interface UploadHeaderMediaInput {
  bytes: ArrayBuffer;
  mimeType: string;
  filename?: string;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  markedDeleted: number;
}

// Default page size — Meta caps at 200 per page.
const DEFAULT_LIST_PAGE_SIZE = 200;

// Template name rule (Meta enforces lowercase / digits / underscore only).
const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

// Default Graph API version used by upload helper when not overridden.
const DEFAULT_API_VERSION = 'v25.0';

// ─────────────────────────────────────────────────────────────────────────────
// List + get (Graph API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /{waba_id}/message_templates — paginated.
 *
 * Walks `paging.next` cursors until exhausted. Returns the full collection.
 */
export async function listTemplatesFromMeta(
  client: MetaWhatsAppClient,
  wabaId: string,
  options: { status?: MetaTemplateStatus; pageSize?: number } = {},
): Promise<MetaTemplateRecord[]> {
  const fields = 'id,name,language,category,status,components,rejected_reason,quality_score';
  const limit = options.pageSize ?? DEFAULT_LIST_PAGE_SIZE;

  const statusQuery = options.status ? `&status=${encodeURIComponent(options.status)}` : '';
  const initialPath = `/${wabaId}/message_templates?fields=${fields}&limit=${limit}${statusQuery}`;

  const all: MetaTemplateRecord[] = [];
  let nextUrl: string | undefined;
  let page: MetaTemplateListPage = await client.get<MetaTemplateListPage>(initialPath);

  while (true) {
    if (Array.isArray(page.data)) {
      all.push(...page.data);
    }
    nextUrl = page.paging?.next;
    if (!nextUrl) break;

    // `paging.next` is an absolute URL — fetch it directly. We reuse the
    // client's bearer auth + timeout via getAbsolute.
    page = await getAbsolute<MetaTemplateListPage>(client, nextUrl);
  }

  return all;
}

/** GET /{template_id} — fetch a single template by Graph API id. */
export async function getTemplateFromMeta(
  client: MetaWhatsAppClient,
  templateId: string,
): Promise<MetaTemplateRecord> {
  const fields = 'id,name,language,category,status,components,rejected_reason,quality_score';
  return client.get<MetaTemplateRecord>(`/${templateId}?fields=${fields}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Create + delete (Graph API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /{waba_id}/message_templates — submit a template for Meta review.
 *
 * Templates land in PENDING and move to APPROVED / REJECTED asynchronously via
 * the `message_template_status_update` webhook.
 */
export async function createTemplate(
  client: MetaWhatsAppClient,
  wabaId: string,
  input: CreateTemplateInput,
): Promise<CreateTemplateResult> {
  if (!TEMPLATE_NAME_RE.test(input.name)) {
    throw new MetaApiError(
      MetaErrorCode.INVALID_REQUEST,
      `Template name '${input.name}' is invalid — Meta accepts only [a-z0-9_]`,
      { operation: 'createTemplate' },
    );
  }

  const payload = {
    name: input.name,
    language: input.language,
    category: input.category,
    components: input.components,
  };

  const res = await client.post<{ id: string; status: MetaTemplateStatus; category?: MetaTemplateCategory }>(
    `/${wabaId}/message_templates`,
    payload,
  );

  return { id: res.id, status: res.status ?? ('PENDING' as MetaTemplateStatus) };
}

/**
 * DELETE /{waba_id}/message_templates?name={name}[&hsm_id={id}]
 *
 * Per Meta docs, `name` deletes ALL templates with that name across languages.
 * Pass `hsmId` to scope the delete to a single (name, language) pair.
 */
export async function deleteTemplate(
  client: MetaWhatsAppClient,
  wabaId: string,
  templateName: string,
  hsmId?: string,
): Promise<void> {
  const q = new URLSearchParams({ name: templateName });
  if (hsmId) q.set('hsm_id', hsmId);
  await client.delete(`/${wabaId}/message_templates?${q.toString()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Header media upload (Resumable Upload API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two-step Resumable Upload API:
 *   Step 1: POST /{app_id}/uploads?file_length=N&file_type=MIME → { id: "upload:<session>" }
 *   Step 2: POST /{session_id} with raw bytes + Authorization: OAuth <token> → { h: "<handle>" }
 *
 * The returned handle is what goes into the template payload's
 * `components[].example.header_handle` for image/video/document headers.
 *
 * NOTE: This is the only path in the codebase that uses `OAuth <token>` (not
 * `Bearer <token>`) — Meta requires it for the bytes-upload step.
 */
export async function uploadHeaderMedia(
  appId: string,
  accessToken: string,
  file: UploadHeaderMediaInput,
  apiVersion: string = DEFAULT_API_VERSION,
): Promise<{ handle: string }> {
  const baseUrl = `https://graph.facebook.com/${apiVersion}`;
  const fileLength = file.bytes.byteLength;
  const fileType = file.mimeType;
  const filename = file.filename ?? 'upload';

  // Step 1 — create upload session.
  const sessionQuery = new URLSearchParams({
    file_name: filename,
    file_length: String(fileLength),
    file_type: fileType,
  });
  const sessionRes = await fetch(`${baseUrl}/${appId}/uploads?${sessionQuery.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!sessionRes.ok) {
    throw await throwUploadError(sessionRes, 'POST /uploads (create session)');
  }
  const sessionJson = (await sessionRes.json()) as { id?: string };
  const sessionId = sessionJson.id;
  if (!sessionId) {
    throw new MetaApiError(MetaErrorCode.UNKNOWN, 'Meta did not return an upload session id', {
      operation: 'uploadHeaderMedia',
      raw: sessionJson,
    });
  }

  // Step 2 — upload the bytes. `Authorization: OAuth …` is required (not Bearer).
  const bytesRes = await fetch(`${baseUrl}/${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
      'Content-Type': fileType,
    },
    body: file.bytes,
  });
  if (!bytesRes.ok) {
    throw await throwUploadError(bytesRes, 'POST /{session_id} (upload bytes)');
  }
  const bytesJson = (await bytesRes.json()) as { h?: string };
  if (!bytesJson.h) {
    throw new MetaApiError(MetaErrorCode.UNKNOWN, 'Meta did not return an upload handle', {
      operation: 'uploadHeaderMedia',
      raw: bytesJson,
    });
  }
  return { handle: bytesJson.h };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync (Meta → local DB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconciles local `whatsapp_templates` rows with the live Graph API state.
 *
 * Algorithm:
 *   1. Load all local rows for the instance.
 *   2. For each Meta template:
 *        - If the local row (matched on name+language) exists, UPDATE
 *          status / components / rejection / quality.
 *        - Otherwise INSERT a new row.
 *   3. Any local row whose (name, language) is NOT in the Meta payload and
 *      whose status != 'DELETED' is marked status='DELETED'.
 *
 * Returns counts useful for ops logging / dashboards.
 */
export async function syncTemplatesToDb(
  db: Database,
  instanceId: string,
  wabaId: string,
  metaTemplates: MetaTemplateRecord[],
): Promise<SyncResult> {
  // 1) Snapshot local rows.
  const localRows = await db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.instanceId, instanceId));

  // Lookup map keyed on (name, language).
  const localByKey = new Map<string, WhatsappTemplate>();
  for (const row of localRows) {
    localByKey.set(localKey(row.name, row.language), row);
  }

  let inserted = 0;
  let updated = 0;
  const seenKeys = new Set<string>();

  for (const tmpl of metaTemplates) {
    const key = localKey(tmpl.name, tmpl.language);
    seenKeys.add(key);

    const existing = localByKey.get(key);
    if (existing) {
      await db
        .update(whatsappTemplates)
        .set({
          metaId: tmpl.id,
          wabaId,
          category: tmpl.category,
          status: tmpl.status,
          components: (tmpl.components ?? null) as unknown[] | null,
          rejectionReason: tmpl.rejected_reason ?? null,
          qualityScore: tmpl.quality_score?.score ?? null,
          updatedAt: new Date(),
        })
        .where(eq(whatsappTemplates.id, existing.id));
      updated++;
    } else {
      const insertRow: NewWhatsappTemplate = {
        instanceId,
        metaId: tmpl.id,
        wabaId,
        name: tmpl.name,
        language: tmpl.language,
        category: tmpl.category,
        status: tmpl.status,
        components: (tmpl.components ?? null) as unknown[] | null,
        rejectionReason: tmpl.rejected_reason ?? null,
        qualityScore: tmpl.quality_score?.score ?? null,
      };
      await db.insert(whatsappTemplates).values(insertRow);
      inserted++;
    }
  }

  // 3) Mark stale rows (present locally, missing from Meta) as DELETED.
  const staleIds: string[] = [];
  for (const row of localRows) {
    const key = localKey(row.name, row.language);
    if (!seenKeys.has(key) && row.status !== 'DELETED') {
      staleIds.push(row.id);
    }
  }

  let markedDeleted = 0;
  if (staleIds.length > 0) {
    await db
      .update(whatsappTemplates)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(and(eq(whatsappTemplates.instanceId, instanceId), inArray(whatsappTemplates.id, staleIds)));
    markedDeleted = staleIds.length;
  }

  return { inserted, updated, markedDeleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook: message_template_status_update
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle the `message_template_status_update` field from the Meta webhook.
 *
 * Maps Meta's lifecycle `event` (APPROVED | REJECTED | PAUSED | DISABLED |
 * FLAGGED) onto our local status enum, updates the row, and emits a single
 * `template.status_changed` event.
 *
 * Group 4's webhook handler invokes this AFTER signature verification and
 * AFTER the inbound dedupe cache has cleared the entry. Idempotency: we re-
 * read the row to capture the previous status before updating.
 */
export async function handleTemplateStatusUpdate(
  db: Database,
  update: MetaTemplateStatusUpdate,
  plugin: WhatsAppCloudPlugin,
): Promise<void> {
  const newStatus = mapMetaEventToStatus(update.event);

  // Match rows by either:
  //   (a) `meta_id` (most precise — set on row after first Meta sync)
  //   (b) (name, language) (fallback for rows that haven't been reconciled
  //       to a metaId yet — e.g. created on the Meta UI before the local
  //       sync ran).
  //
  // Multiple rows can match (same template name+language used by N instances
  // that share a WABA — though we have a unique constraint on
  // (instance_id, name, language) so a single instance only ever has one).
  // We emit + update per row so each instance's event scope is correct.
  const rows = await db
    .select()
    .from(whatsappTemplates)
    .where(
      or(
        eq(whatsappTemplates.metaId, update.message_template_id),
        and(
          eq(whatsappTemplates.name, update.message_template_name),
          eq(whatsappTemplates.language, update.message_template_language),
        ),
      ),
    );

  if (rows.length === 0) {
    // No local row to update — caller can re-sync. Skip event emission so we
    // don't fan out a status_changed for a template the system doesn't
    // know about yet.
    return;
  }

  for (const row of rows) {
    const previousStatus = (row.status as MetaTemplateStatus) ?? null;

    await db
      .update(whatsappTemplates)
      .set({
        metaId: update.message_template_id,
        status: newStatus,
        rejectionReason: update.event === 'REJECTED' ? update.reason ?? null : null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappTemplates.id, row.id));

    await plugin.handleTemplateStatusChanged(row.instanceId, update, {
      templateId: row.id,
      previousStatus: previousStatus ?? undefined,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function localKey(name: string, language: string): string {
  return `${name}::${language}`;
}

/**
 * Meta's webhook delivers `event` values that don't all map 1:1 to our local
 * status enum. We normalize:
 *   APPROVED → APPROVED
 *   REJECTED → REJECTED
 *   PAUSED   → PAUSED
 *   DISABLED → DELETED       (terminal — Meta won't re-enable it)
 *   FLAGGED  → PAUSED        (Meta semantics: under review)
 */
function mapMetaEventToStatus(event: MetaTemplateStatusUpdate['event']): MetaTemplateStatus {
  switch (event) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'PAUSED':
    case 'FLAGGED':
      return 'PAUSED';
    case 'DISABLED':
      return 'DELETED';
    default: {
      // Exhaustive guard: forces a compile error if Meta adds a new event arm.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * GET against an absolute URL (used to follow `paging.next`). Falls back on the
 * same bearer auth + timeout as the client, but bypasses the base-url prefix.
 */
async function getAbsolute<T>(client: MetaWhatsAppClient, absoluteUrl: string): Promise<T> {
  // The Graph API base looks like `https://graph.facebook.com/v25.0`; pagination
  // URLs are full, e.g. `https://graph.facebook.com/v25.0/{waba}/message_templates?after=...`.
  // We strip the prefix to reuse client.get(), which preserves auth/timeout.
  const base = `https://graph.facebook.com/${client.apiVersion}`;
  if (absoluteUrl.startsWith(base)) {
    return client.get<T>(absoluteUrl.slice(base.length));
  }
  // Defensive fallback: in tests the base url may differ; do a direct fetch
  // using the headers we know the client uses. We can't reach the private
  // headers helper from outside, so just bail on this edge case with a clear
  // error rather than silently mis-pointing.
  throw new MetaApiError(
    MetaErrorCode.UNKNOWN,
    `paging.next URL not on expected Graph API base (got ${absoluteUrl})`,
    { operation: 'listTemplatesFromMeta:paginate' },
  );
}

async function throwUploadError(res: Response, op: string): Promise<MetaApiError> {
  let bodyText = '';
  let envelope: { error?: { code?: number; message?: string; fbtrace_id?: string } } | undefined;
  try {
    bodyText = await res.text();
    if (bodyText) envelope = JSON.parse(bodyText);
  } catch {
    /* ignore */
  }
  const apiError = envelope?.error;
  const code = apiError?.code !== undefined ? mapHttpStatusToMetaError(apiError.code) : mapHttpStatusToMetaError(res.status);
  const message = apiError?.message ?? `HTTP ${res.status} from ${op}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`;
  return new MetaApiError(code, message, {
    httpStatus: res.status,
    operation: op,
    metaErrorCode: apiError?.code,
    fbtraceId: apiError?.fbtrace_id,
    raw: envelope ?? bodyText,
  });
}
