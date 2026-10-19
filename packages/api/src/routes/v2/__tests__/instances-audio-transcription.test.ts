/**
 * instances.audio_transcription round-trips through the instance API.
 *
 * Opt-in: a PATCH that omits audioTranscription must never reset the stored
 * value (the update schema strips the create-time 'auto' default), an explicit
 * value passes through, an unknown value is a 400, and GET returns the column.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '55555555-5555-4555-8555-555555555555';

function mount(stored: 'auto' | 'off') {
  const app = new Hono<{ Variables: AppVariables }>();
  let row: Record<string, unknown> = {
    id: INSTANCE_ID,
    name: 'audio-transcription',
    channel: 'whatsapp-baileys',
    agentId: null,
    audioTranscription: stored,
  };
  const update = mock(async (_id: string, data: Record<string, unknown>) => {
    row = { ...row, ...data };
    return row;
  });
  app.use('*', async (c, next) => {
    c.set('services', { instances: { getById: mock(async () => row), update } } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);
  const patch = (body: unknown) =>
    app.request(`/instances/${INSTANCE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = async () =>
    ((await (await app.request(`/instances/${INSTANCE_ID}`)).json()) as { data: Record<string, unknown> }).data;
  return { patch, get, update };
}

describe('instance audioTranscription', () => {
  test('PATCH without the field passes no audioTranscription key, so the stored value is kept', async () => {
    const { patch, get, update } = mount('off');
    expect((await patch({ name: 'renamed' })).status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('audioTranscription');
    expect((await get()).audioTranscription).toBe('off');
  });

  test("PATCH with 'off' passes it through to the update", async () => {
    const { patch, update } = mount('auto');
    expect((await patch({ audioTranscription: 'off' })).status).toBe(200);
    expect(update.mock.calls[0]?.[1]).toMatchObject({ audioTranscription: 'off' });
  });

  test('PATCH with an invalid value is rejected before anything is written', async () => {
    const { patch, update } = mount('auto');
    const res = await patch({ audioTranscription: 'never' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(update).not.toHaveBeenCalled();
  });

  test('GET returns the stored audioTranscription', async () => {
    const { get } = mount('off');
    expect(await get()).toMatchObject({ id: INSTANCE_ID, audioTranscription: 'off' });
  });
});
