import { describe, expect, mock, test } from 'bun:test';
import type { WASocket } from 'baileys';
import { WhatsAppPlugin, ownPhoneJid, selfPlatformMessageId } from '../plugin';

const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '5511999998888@s.whatsapp.net';
function fixture() {
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
  };
  fields.sockets.set(ID, sock as unknown as WASocket);
  fields.instances.getStatus = () => ({ state: 'connected' });
  fields.waitForRateLimitBackoff = async () => ({ reset() {} });
  fields.emitMessageSent = async () => {};
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
    const f = fixture();
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
    const f = fixture();
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
      const f = fixture();
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
    const f = fixture();
    f.sock.sendMessage.mockImplementation(async () => {
      throw new Error('Fictional timeout after send');
    });
    await expect(f.plugin.sendSelf(ID, f.input)).rejects.toThrow();
    expect(f.sock.sendMessage).toHaveBeenCalledTimes(1);
    expect(f.plugin.isBotSentMessage(ID, selfPlatformMessageId(ID, OWNER, f.input.operationKey))).toBe(true);
  });
});
