import { expect, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { InstanceSchema, InstanceSettingsSchema } from '../../../schemas/openapi/instances';
import type { AppVariables } from '../../../types';
import { openApiSpec } from '../../openapi';
import { instancesRoutes } from '../instances';

const ID = '33333333-3333-4333-8333-333333333333';
// Independent issue #1403 fixture: all 57 writable settings, not derived from the implementation.
const settings = {
  agentReplyFilter: { mode: 'all', conditions: { onDm: true, onMention: true, onReply: true, onNameMatch: false } },
  agentSessionStrategy: 'per_chat',
  agentPrefixSenderName: false,
  agentGateEnabled: false,
  agentGateModel: null,
  agentGatePrompt: null,
  agentWaitForMedia: false,
  agentSendMediaPath: false,
  agentSendMediaPathTypes: [],
  agentStalledTimeoutMs: 0,
  messageSupersedeMode: 'discard',
  enableAutoSplit: false,
  messageFormatMode: 'passthrough',
  disableUsernamePrefix: true,
  triggerEvents: [],
  triggerReactions: [],
  triggerMentionPatterns: [],
  triggerMode: 'fire-and-forget',
  agentChainToInstanceId: ID,
  chainMode: 'forward',
  sessionReset: { dm: { mode: 'daily', hour: 0 } },
  inboundMaxAgeMinutes: 0,
  replayEnabled: false,
  inboundReplyContext: false,
  messageDebounceMode: 'presence',
  messageDebounceMinMs: 0,
  messageDebounceGroupMs: null,
  messageDebounceMaxMs: 0,
  messageDebounceRestartOnTyping: false,
  messageDebounceMaxWaitMs: null,
  messageSplitDelayMode: 'fixed',
  messageSplitDelayFixedMs: 0,
  messageSplitDelayMinMs: 0,
  messageSplitDelayMaxMs: 0,
  reactionAck: 'off',
  reactionAckEmoji: {},
  ackTimeoutMs: 0,
  agentAckMessage: '',
  readReceipts: 'off',
  markOnlineOnConnect: false,
  processAudio: false,
  processImages: false,
  processVideo: false,
  processDocuments: false,
  processMediaOnBlocked: false,
  downloadMediaOnSync: false,
  audioTranscription: 'off',
  accessMode: 'allowlist',
  groupHistorySize: 0,
  historyIdentity: 'web',
  syncFullHistory: false,
  ttsVoiceId: null,
  ttsModelId: null,
  followUpConfig: {
    enabled: true,
    schedule: { kind: 'fixed', intervalsMinutes: [1] },
    maxFollowUps: 2,
    promptTemplate: 'Follow up',
    stopOutsideMessagingWindow: true,
    showTypingIndicator: false,
  },
  closeContactConfig: { won: { cooldownMs: null } },
  outboundPacing: 'humanized',
  outboundPacingOverride: false,
};
const meta = {
  metaPhoneNumberId: '123456789',
  metaWabaId: '234567890',
  metaAppId: '345678901',
  metaBusinessId: '456789012',
  metaApiVersion: 'v25.0',
  metaConnectionMethod: 'manual',
  metaConnectedAt: '2026-10-29T12:00:00.000Z',
  metaDisplayPhoneNumber: '+5511999999999',
};
function mount(instanceIds: string[] | null = null, targetState = 'present', targetId = ID) {
  const writes: Record<string, unknown>[] = [];
  const reads: string[] = [];
  let row: Record<string, unknown> = {
    id: ID,
    name: 'settings',
    channel: 'whatsapp-business',
    ...settings,
    agentChainToInstanceId: targetId,
    ...meta,
    metaAccessToken: 'fixture-only-do-not-return',
  };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds } as never);
    c.set('services', {
      instances: {
        getById: async (requested: string) => {
          reads.push(requested);
          if (requested !== ID && targetState !== 'present') throw new NotFoundError('Instance', targetState);
          return { ...row, id: requested };
        },
        update: async (_id: string, data: Record<string, unknown>) => {
          writes.push(data);
          row = { ...row, ...data };
          return row;
        },
      },
    } as never);
    await next();
  });
  app.route('/', instancesRoutes);
  const patch = (body: unknown) =>
    app.request(`/${ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { app, writes, patch, reads };
}
test('chain targets reuse instance scope and tenant visibility without blocking cleanup', async () => {
  const target = '44444444-4444-4444-8444-444444444444';
  const changes = [
    { agentChainToInstanceId: target, chainMode: 'forward' },
    { agentChainToInstanceId: target, chainMode: 'off' },
    { chainMode: 'forward' },
    { chainMode: 'bidirectional' },
  ];
  for (const change of changes) {
    const { patch, writes, reads } = mount([ID], 'present', target);
    expect((await patch(change)).status).toBe(403);
    expect(writes).toHaveLength(0);
    expect(reads).not.toContain(target);
    for (const scope of [[ID, target], null]) {
      const allowed = mount(scope, 'present', target);
      expect((await allowed.patch(change)).status).toBe(200);
      expect(allowed.writes).toHaveLength(1);
      expect(allowed.reads).toContain(target);
    }
  }
  for (const state of ['missing', 'foreign-tenant']) {
    const { patch, writes } = mount([ID, target], state, target);
    const response = await patch({ agentChainToInstanceId: target, chainMode: 'forward' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Chain target is not accessible' } });
    expect(writes).toHaveLength(0);
  }
  for (const change of [
    { agentChainToInstanceId: null },
    { agentChainToInstanceId: null, chainMode: 'forward' },
    { chainMode: 'off' },
    { processAudio: false },
  ]) {
    const { patch, writes, reads } = mount([ID], 'missing', target);
    expect((await patch(change)).status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(reads).not.toContain(target);
  }
});

test('every issue setting and all eight Meta identifiers persist, individually and together', async () => {
  expect(Object.keys(settings)).toHaveLength(57);
  const { patch, writes, app } = mount();
  for (const [key, value] of Object.entries({ ...settings, ...meta })) {
    expect((await patch({ [key]: value })).status).toBe(200);
    expect(Object.keys(writes.at(-1) ?? {})).toEqual([key]);
    expect(writes.at(-1)?.[key]).toEqual(key === 'metaConnectedAt' ? new Date(String(value)) : value);
  }
  expect((await patch({ ...settings, ...meta })).status).toBe(200);
  const result = (await (await app.request(`/${ID}`)).json()) as { data: Record<string, unknown> };
  expect(result.data).toMatchObject({ ...settings, ...meta, agentProviderId: null });
  expect(result.data).not.toHaveProperty('metaAccessToken');
});
test('partial updates preserve every omitted setting, including falsy values and structured config', async () => {
  const { patch, writes, app } = mount();
  expect((await patch({ agentAckMessage: 'new' })).status).toBe(200);
  expect(writes).toEqual([{ agentAckMessage: 'new' }]);
  const result = (await (await app.request(`/${ID}`)).json()) as { data: Record<string, unknown> };
  expect(result.data).toMatchObject({ ...settings, agentAckMessage: 'new' });
});
test('explicit reply filters retain existing normalization without resetting other settings', async () => {
  const { patch, writes } = mount();
  expect((await patch({ agentReplyFilter: { mode: 'filtered' } })).status).toBe(200);
  expect(writes).toEqual([
    {
      agentReplyFilter: {
        mode: 'filtered',
        conditions: {
          onDm: true,
          onMention: true,
          onReply: true,
          onNameMatch: false,
        },
      },
    },
  ]);
});

test('DB-nullable fields clear; null on NOT NULL, malformed nested values and unknown keys never write', async () => {
  const { patch, writes } = mount();
  for (const key of [
    'agentChainToInstanceId',
    'triggerReactions',
    'sessionReset',
    'followUpConfig',
    'metaConnectedAt',
    'metaAppId',
  ]) {
    expect((await patch({ [key]: null })).status).toBe(200);
    expect(writes.at(-1)).toEqual({ [key]: null });
  }
  const before = writes.length;
  for (const invalid of [
    { chainMode: 'invalid' },
    { processAudio: null },
    { processImages: 'false' },
    { inboundMaxAgeMinutes: -1 },
    { triggerReactions: [2] },
    { agentChainToInstanceId: 'bad' },
    { sessionReset: { dm: { mode: 'daily', hour: 24 } } },
    { sessionReset: { surprise: {} } },
    { followUpConfig: { enabled: true } },
    { metaApiVersion: null },
    { metaApiVersion: 'latest' },
    { metaConnectedAt: 'yesterday' },
    { metaAppId: 'x'.repeat(65) },
    { surprise: true },
    { agentProviderId: ID },
  ]) {
    expect((await patch(invalid)).status).toBe(400);
  }
  expect(writes).toHaveLength(before);
});
test('response requiredness and named SDK component stay compatible', () => {
  const required =
    'id name channel isActive isDefault profileName profilePicUrl historyIdentity syncFullHistory audioTranscription inboundReplyContext ownerIdentifier agentTimeout agentStreamMode createdAt updatedAt'.split(
      ' ',
    );
  expect(
    Object.entries(InstanceSchema.shape)
      .filter(([, schema]) => !schema.isOptional())
      .map(([key]) => key)
      .sort(),
  ).toEqual(required.sort());
  const response = openApiSpec.components?.schemas?.Instance as {
    required: string[];
    properties: Record<string, unknown>;
  };
  expect(response.required.sort()).toEqual(required);
  for (const key of [...Object.keys(settings), ...Object.keys(meta), 'agentId', 'agentProviderId'])
    expect(response.properties).toHaveProperty(key);
  const body = openApiSpec.paths['/instances/{id}']?.get?.responses?.['200'];
  expect(JSON.stringify(body)).toContain('#/components/schemas/Instance');
});

test('public settings contract covers the independent fixture without defaults', () => {
  expect(InstanceSettingsSchema.parse({})).toEqual({});
  expect(InstanceSettingsSchema.parse({ ...settings, ...meta }) as unknown).toEqual({ ...settings, ...meta });
  expect(Object.keys(InstanceSettingsSchema.shape).sort()).toEqual(
    [...Object.keys(settings), ...Object.keys(meta), 'agentId'].sort(),
  );
});
