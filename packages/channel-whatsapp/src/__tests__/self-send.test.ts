import { describe, expect, mock, test } from 'bun:test';
import type { WASocket } from 'baileys';
import { WhatsAppPlugin, ownPhoneJid, selfPlatformMessageId } from '../plugin';

const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '5511999998888@s.whatsapp.net';
async function fixture() {
  const plugin = new WhatsAppPlugin();
  const sock = {
    user: { id: OWNER.replace('@', ':7@') },
    sendMessage: mock(async (_to: string, _content: unknown, options: { messageId: string }) => ({
      key: { id: options.messageId },
    })),
  };
  const fields = plugin as unknown as {
    sockets: Map<string, WASocket>;
    instances: { getStatus(id: string): { state: string } };
    waitForRateLimitBackoff(id: string): Promise<{ reset(): void }>;
    emitMessageSent(value: unknown): Promise<void>;
    emitInstanceConnected(id: string, value: unknown): Promise<void>;
    prefetchGroupMetadata(id: string, socket: WASocket): Promise<void>;
  };
  fields.sockets.set(ID, sock as unknown as WASocket);
  fields.instances.getStatus = () => ({ state: 'connected' });
  fields.waitForRateLimitBackoff = async () => ({ reset() {} });
  fields.emitMessageSent = async () => {};
  fields.emitInstanceConnected = async () => {};
  fields.prefetchGroupMetadata = async () => {};
  await plugin.handleConnected(ID, sock as unknown as WASocket);
  const identity = plugin.getSelfIdentity(ID);
  const input = {
    expectedOwner: OWNER,
    expectedGeneration: identity.generation,
    operationKey: 'fictional-operation',
    text: 'Fictional invitation',
  };
  return { plugin, sock, fields, input };
}
describe('native self-only capability', () => {
  test('own normalized phone, stable operation ID, and echo known before platform call', async () => {
    const f = await fixture();
    const id = selfPlatformMessageId(ID, OWNER, f.input.operationKey);
    f.sock.sendMessage.mockImplementation(async (to, _content, options) => {
      expect(to).toBe(OWNER);
      expect(options.messageId).toBe(id);
      expect(f.plugin.isBotSentMessage(ID, id)).toBe(true);
      return { key: { id } };
    });
    expect(await f.plugin.sendSelf(ID, f.input)).toEqual({
      externalId: id,
      ownerIdentifier: OWNER,
      generation: f.input.expectedGeneration,
    });
    expect(f.plugin.getSelfIdentity(ID).generation).toBe(f.input.expectedGeneration);
  });
  test('arbitrary recipient, foreign expected owner, LID and group cannot send', async () => {
    const f = await fixture();
    await expect(f.plugin.sendSelf(ID, { ...f.input, to: 'other@s.whatsapp.net' } as typeof f.input)).rejects.toThrow();
    await expect(
      f.plugin.sendSelf(ID, { ...f.input, expectedOwner: '5511888887777@s.whatsapp.net' }),
    ).rejects.toThrow();
    for (const value of ['123@lid', '123@g.us', 'status@broadcast', undefined])
      expect(() => ownPhoneJid(value)).toThrow();
    expect(f.sock.sendMessage).not.toHaveBeenCalled();
  });
  test('socket replacement, account change and disconnect during awaited preparation refuse', async () => {
    for (const change of ['socket', 'owner', 'disconnect']) {
      const f = await fixture();
      let release!: () => void;
      f.fields.waitForRateLimitBackoff = () =>
        new Promise((resolve) => {
          release = () => resolve({ reset() {} });
        });
      const pending = f.plugin.sendSelf(ID, f.input);
      if (change === 'socket') f.fields.sockets.set(ID, { ...f.sock } as unknown as WASocket);
      if (change === 'owner') f.sock.user.id = '5511888887777@s.whatsapp.net';
      if (change === 'disconnect') f.fields.instances.getStatus = () => ({ state: 'disconnected' });
      release();
      await expect(pending).rejects.toThrow();
      expect(f.sock.sendMessage).not.toHaveBeenCalled();
    }
  });
  test('platform failure retains known echo identity and does not retry transport', async () => {
    const f = await fixture();
    f.sock.sendMessage.mockImplementation(async () => {
      throw new Error('Fictional timeout after send');
    });
    await expect(f.plugin.sendSelf(ID, f.input)).rejects.toThrow();
    expect(f.sock.sendMessage).toHaveBeenCalledTimes(1);
    expect(f.plugin.isBotSentMessage(ID, selfPlatformMessageId(ID, OWNER, f.input.operationKey))).toBe(true);
  });
  test('authenticated epoch is captured before profile await, stays socket-bound, and missing epoch refuses', async () => {
    const f = await fixture();
    const original = f.plugin.getSelfIdentity(ID);
    let release!: () => void;
    const replacement = {
      ...f.sock,
      profilePictureUrl: () =>
        new Promise<string>((resolve) => {
          release = () => resolve('fictional-picture');
        }),
    };
    f.fields.sockets.set(ID, replacement as unknown as WASocket);
    expect(() => f.plugin.getSelfIdentity(ID)).toThrow('epoch');
    const pending = f.plugin.handleConnected(ID, replacement as unknown as WASocket);
    const first = f.plugin.getSelfIdentity(ID);
    expect(Number.isFinite(Date.parse(first.connectedAt))).toBe(true);
    expect(first.generation).not.toBe(original.generation);
    release();
    await pending;
    expect(f.plugin.getSelfIdentity(ID)).toEqual(first);
  });
  test('repeated native connected event preserves the original socket epoch and generation', async () => {
    const f = await fixture();
    const first = f.plugin.getSelfIdentity(ID);
    await f.plugin.handleConnected(ID, f.sock as unknown as WASocket);
    expect(f.plugin.getSelfIdentity(ID)).toEqual(first);
  });
  test('unsupported own identity cannot gain self capability or break ordinary connection handling', async () => {
    const f = await fixture();
    f.sock.user.id = '123@lid';
    await f.plugin.handleConnected(ID, f.sock as unknown as WASocket);
    expect(() => f.plugin.getSelfIdentity(ID)).toThrow();
    expect(f.sock.sendMessage).not.toHaveBeenCalled();
  });
});
