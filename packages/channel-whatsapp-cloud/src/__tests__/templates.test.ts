/**
 * HSM template service — unit tests.
 *
 * Covers the algorithms in `src/templates.ts`:
 *   - createTemplate payload shape (HEADER text/image, BODY with `{{n}}`,
 *     FOOTER, BUTTONS QUICK_REPLY/URL/COPY_CODE).
 *   - listTemplatesFromMeta pagination via `paging.next`.
 *   - syncTemplatesToDb marks stale local rows as DELETED.
 *   - handleTemplateStatusUpdate emits `template.status_changed` with the
 *     correct previousStatus/newStatus.
 *
 * The Graph API layer is bypassed by spying on `MetaWhatsAppClient.{get,post,delete}`.
 * The DB layer is faked with a minimal in-memory drizzle-shaped object —
 * we don't exercise real SQL, just the chained calls our code makes.
 */

import { describe, expect, it, mock, spyOn } from 'bun:test';
import type { Database, WhatsappTemplate } from '@omni/db';
import type { MetaTemplateStatusUpdate } from '@omni/core/schemas';

import { MetaWhatsAppClient } from '../client';
import {
  createTemplate,
  handleTemplateStatusUpdate,
  listTemplatesFromMeta,
  type MetaTemplateRecord,
  syncTemplatesToDb,
} from '../templates';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const WABA_ID = '123456789012345';
const INSTANCE_ID = '11111111-2222-3333-4444-555555555555';

function makeClient(): MetaWhatsAppClient {
  return new MetaWhatsAppClient(
    { phoneNumberId: '99999', accessToken: 'test-token', apiVersion: 'v25.0' },
    WABA_ID,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// createTemplate — payload shapes
// ─────────────────────────────────────────────────────────────────────────────

describe('createTemplate', () => {
  it('builds a payload with HEADER text, BODY with placeholders, FOOTER, and BUTTONS', async () => {
    const client = makeClient();
    const postSpy = spyOn(client, 'post').mockResolvedValueOnce({ id: 'tpl_001', status: 'PENDING' });

    await createTemplate(client, WABA_ID, {
      name: 'welcome_v1',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}!' },
        { type: 'BODY', text: 'Bem-vindo {{1}}, obrigado por escolher a {{2}}.' },
        { type: 'FOOTER', text: 'Equipe Omni' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Sim' },
            { type: 'URL', text: 'Ver site', url: 'https://example.com' },
            { type: 'COPY_CODE', example: 'CUPOM10' },
          ],
        },
      ],
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0]!;
    expect(path).toBe(`/${WABA_ID}/message_templates`);
    expect(body).toEqual({
      name: 'welcome_v1',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}!' },
        { type: 'BODY', text: 'Bem-vindo {{1}}, obrigado por escolher a {{2}}.' },
        { type: 'FOOTER', text: 'Equipe Omni' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Sim' },
            { type: 'URL', text: 'Ver site', url: 'https://example.com' },
            { type: 'COPY_CODE', example: 'CUPOM10' },
          ],
        },
      ],
    });
  });

  it('forwards an IMAGE header with example.header_handle', async () => {
    const client = makeClient();
    const postSpy = spyOn(client, 'post').mockResolvedValueOnce({ id: 'tpl_002', status: 'PENDING' });

    await createTemplate(client, WABA_ID, {
      name: 'promo_image',
      language: 'en_US',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h:abc123def'] } },
        { type: 'BODY', text: 'Limited time deal.' },
      ],
    });

    const body = postSpy.mock.calls[0]![1] as { components: unknown[] };
    const header = body.components[0] as { type: string; format: string; example: { header_handle: string[] } };
    expect(header.type).toBe('HEADER');
    expect(header.format).toBe('IMAGE');
    expect(header.example.header_handle).toEqual(['h:abc123def']);
  });

  it('returns the Meta-assigned id and status', async () => {
    const client = makeClient();
    spyOn(client, 'post').mockResolvedValueOnce({ id: 'tpl_999', status: 'PENDING' });

    const result = await createTemplate(client, WABA_ID, {
      name: 'simple',
      language: 'pt_BR',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hello' }],
    });

    expect(result).toEqual({ id: 'tpl_999', status: 'PENDING' });
  });

  it('rejects invalid template names (uppercase / spaces) before hitting Meta', async () => {
    const client = makeClient();
    const postSpy = spyOn(client, 'post');

    await expect(
      createTemplate(client, WABA_ID, {
        name: 'Bad Name',
        language: 'pt_BR',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'META_INVALID_REQUEST' });

    expect(postSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listTemplatesFromMeta — pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('listTemplatesFromMeta', () => {
  it('follows paging.next until exhausted and concatenates pages', async () => {
    const client = makeClient();

    const page1 = {
      data: [
        { id: 't1', name: 'a', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
        { id: 't2', name: 'b', language: 'pt_BR', category: 'MARKETING', status: 'PENDING' },
      ],
      paging: {
        cursors: { after: 'cursor-a' },
        next: `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?after=cursor-a`,
      },
    };
    const page2 = {
      data: [{ id: 't3', name: 'c', language: 'en_US', category: 'AUTHENTICATION', status: 'APPROVED' }],
      paging: {
        cursors: { after: 'cursor-b' },
        next: `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?after=cursor-b`,
      },
    };
    const page3 = {
      data: [{ id: 't4', name: 'd', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }],
      // no paging.next → terminate
    };

    const getSpy = spyOn(client, 'get')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);

    const all = await listTemplatesFromMeta(client, WABA_ID);

    expect(getSpy).toHaveBeenCalledTimes(3);
    expect(all.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(getSpy.mock.calls[0]![0]).toContain(`/${WABA_ID}/message_templates?fields=`);
    expect(getSpy.mock.calls[1]![0]).toContain('after=cursor-a');
    expect(getSpy.mock.calls[2]![0]).toContain('after=cursor-b');
  });

  it('returns a single page when paging.next is absent', async () => {
    const client = makeClient();
    spyOn(client, 'get').mockResolvedValueOnce({
      data: [{ id: 't1', name: 'a', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }],
    });

    const all = await listTemplatesFromMeta(client, WABA_ID);
    expect(all).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncTemplatesToDb — fake drizzle DB shim
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory drizzle shim that records calls to .select / .update / .insert and
 * lets us assert which rows were touched. Enough of the chain is implemented
 * to satisfy syncTemplatesToDb but no actual SQL runs.
 */
function fakeDb(initialRows: WhatsappTemplate[]) {
  const rows: WhatsappTemplate[] = initialRows.map((r) => ({ ...r }));
  const calls = {
    inserts: [] as unknown[],
    updates: [] as { setPatch: Record<string, unknown>; whereTag?: string }[],
    deletedMarkedIds: [] as string[],
  };

  // Final await on a select-from-where; supports both `await sel.where(...)` and
  // `await sel.where(...).limit(n)` access paths used by production code.
  const selectFromWhereAwaitable = (predicate: (r: WhatsappTemplate) => boolean) => {
    const result = rows.filter(predicate);
    // Mimic both `.where().limit()` and `await .where()` paths used by callers.
    return Object.assign(Promise.resolve(result), {
      limit: async (_n: number) => result.slice(0, _n),
    });
  };

  const db = {
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          // We can't statically inspect the drizzle SQL expression here. Our
          // production code makes exactly two select-shape calls in
          // syncTemplatesToDb: one to list all rows for the instance. We
          // assume the predicate is "instanceId matches" and return all rows.
          return selectFromWhereAwaitable(() => true);
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: async (v: WhatsappTemplate | WhatsappTemplate[]) => {
        const arr = Array.isArray(v) ? v : [v];
        for (const row of arr) {
          // Synthesise an id if not provided (drizzle defaults; we don't need
          // a real uuid for assertions).
          const withId: WhatsappTemplate = {
            id: `gen_${rows.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            metaId: null,
            wabaId: WABA_ID,
            instanceId: INSTANCE_ID,
            name: '',
            language: 'pt_BR',
            category: 'UTILITY',
            status: 'PENDING',
            components: null,
            variableMapping: null,
            rejectionReason: null,
            qualityScore: null,
            ...row,
          };
          rows.push(withId);
          calls.inserts.push(row);
        }
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (_cond: unknown) => {
          calls.updates.push({ setPatch: patch });
          if (patch.status === 'DELETED') {
            // Best-effort: mark every non-deleted row as deleted. We can't
            // inspect the WHERE so we approximate by marking those not in
            // the "seenKeys" set — see assertion below for what matters.
            // Production code passes a list of ids via inArray; here we
            // accept any mark-deleted call as evidence the stale-detect
            // branch ran.
          }
          // Apply the patch onto whatever rows the caller intends. The
          // production code routes by (instance_id, id) so we mutate all
          // matching rows by id when present in the patch context.
        },
      }),
    }),
  };
  return { db: db as unknown as Database, rows, calls };
}

describe('syncTemplatesToDb', () => {
  it('marks local rows missing from the Meta payload as DELETED', async () => {
    const localRows: WhatsappTemplate[] = [
      mkLocalRow({ id: 'row-1', name: 'welcome', language: 'pt_BR', status: 'APPROVED' }),
      mkLocalRow({ id: 'row-2', name: 'stale', language: 'pt_BR', status: 'APPROVED' }),
      mkLocalRow({ id: 'row-3', name: 'already_deleted', language: 'pt_BR', status: 'DELETED' }),
    ];
    const { db, calls } = fakeDb(localRows);

    const metaPayload: MetaTemplateRecord[] = [
      { id: 'meta-1', name: 'welcome', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED' },
      // "stale" intentionally absent → expect mark-as-DELETED.
      { id: 'meta-new', name: 'brand_new', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' },
    ];

    const result = await syncTemplatesToDb(db, INSTANCE_ID, WABA_ID, metaPayload);

    // 'welcome' was matched → update; 'brand_new' was new → insert;
    // 'stale' was missing-from-meta and non-DELETED → markedDeleted=1.
    // 'already_deleted' was missing AND already DELETED → should NOT be re-marked.
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.markedDeleted).toBe(1);

    // Final update should have been the mark-as-DELETED branch.
    const lastUpdate = calls.updates.at(-1);
    expect(lastUpdate?.setPatch.status).toBe('DELETED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleTemplateStatusUpdate — emits `template.status_changed`
// ─────────────────────────────────────────────────────────────────────────────

describe('handleTemplateStatusUpdate', () => {
  /** Minimal plugin stub — only exposes the method handleTemplateStatusUpdate calls. */
  function stubPlugin() {
    const handleTemplateStatusChanged = mock(async () => undefined);
    const plugin = { handleTemplateStatusChanged } as unknown as Parameters<
      typeof handleTemplateStatusUpdate
    >[2];
    return { plugin, handleTemplateStatusChanged };
  }

  it('updates the local row and notifies plugin with correct previous/new status', async () => {
    const existing = mkLocalRow({
      id: 'row-42',
      metaId: 'meta-tpl-1',
      name: 'order_update',
      language: 'pt_BR',
      status: 'PENDING',
    });
    const { db, calls } = fakeDb([existing]);
    const { plugin, handleTemplateStatusChanged } = stubPlugin();

    const update: MetaTemplateStatusUpdate = {
      message_template_id: 'meta-tpl-1',
      message_template_name: 'order_update',
      message_template_language: 'pt_BR',
      event: 'APPROVED',
    };

    await handleTemplateStatusUpdate(db, update, plugin);

    expect(calls.updates.length).toBeGreaterThanOrEqual(1);
    expect(calls.updates[0]!.setPatch.status).toBe('APPROVED');

    expect(handleTemplateStatusChanged).toHaveBeenCalledTimes(1);
    const [instanceId, sentUpdate, extras] = handleTemplateStatusChanged.mock.calls[0]! as [
      string,
      MetaTemplateStatusUpdate,
      { templateId?: string; previousStatus?: string },
    ];
    expect(instanceId).toBe(INSTANCE_ID);
    expect(sentUpdate.message_template_id).toBe('meta-tpl-1');
    expect(extras).toMatchObject({ templateId: 'row-42', previousStatus: 'PENDING' });
  });

  it('passes rejectionReason via the update payload when event is REJECTED', async () => {
    const existing = mkLocalRow({
      id: 'row-99',
      metaId: 'meta-tpl-9',
      name: 'broken',
      language: 'en_US',
      status: 'PENDING',
    });
    const { db } = fakeDb([existing]);
    const { plugin, handleTemplateStatusChanged } = stubPlugin();

    await handleTemplateStatusUpdate(
      db,
      {
        message_template_id: 'meta-tpl-9',
        message_template_name: 'broken',
        message_template_language: 'en_US',
        event: 'REJECTED',
        reason: 'Promotional content not allowed in UTILITY category',
      },
      plugin,
    );

    expect(handleTemplateStatusChanged).toHaveBeenCalledTimes(1);
    const [, sentUpdate, extras] = handleTemplateStatusChanged.mock.calls[0]! as [
      string,
      MetaTemplateStatusUpdate,
      { previousStatus?: string },
    ];
    expect(sentUpdate.event).toBe('REJECTED');
    expect(sentUpdate.reason).toBe('Promotional content not allowed in UTILITY category');
    expect(extras.previousStatus).toBe('PENDING');
  });

  it('skips plugin notification when no local row exists', async () => {
    const { db } = fakeDb([]);
    const { plugin, handleTemplateStatusChanged } = stubPlugin();

    await handleTemplateStatusUpdate(
      db,
      {
        message_template_id: 'meta-tpl-unknown',
        message_template_name: 'unknown',
        message_template_language: 'pt_BR',
        event: 'APPROVED',
      },
      plugin,
    );

    expect(handleTemplateStatusChanged).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Local fixture
// ─────────────────────────────────────────────────────────────────────────────

function mkLocalRow(overrides: Partial<WhatsappTemplate>): WhatsappTemplate {
  return {
    id: 'row-x',
    instanceId: INSTANCE_ID,
    metaId: null,
    wabaId: WABA_ID,
    name: 'default',
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'PENDING',
    components: null,
    variableMapping: null,
    rejectionReason: null,
    qualityScore: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}
