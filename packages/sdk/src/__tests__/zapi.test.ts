import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createOmniClient } from '../client';

const makeClient = () => createOmniClient({ baseUrl: 'https://gateway.example.com', apiKey: 'test-key' });
let fetchMock: ReturnType<typeof spyOn> | undefined;
afterEach(() => fetchMock?.mockRestore());

describe('SDK Z-API contract without a running server', () => {
  test('create accepts the new channel and forwards write-only credentials', async () => {
    fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      Response.json({ data: { id: 'local', channel: 'zapi-web' } })) as unknown as typeof fetch);
    const config = {
      driver: 'web' as const,
      instanceId: 'remote',
      instanceToken: 'instance-token-12345',
      clientToken: 'client-token-12345',
      webhookToken: 'webhook-token-12345678901234567890',
    };
    await makeClient().instances.create({ name: 'kelvin', channel: 'zapi-web', zapiConfig: config });
    const body = (await (fetchMock.mock.calls[0][0] as Request).clone().json()) as Record<string, unknown>;
    expect(body.zapiConfig).toEqual(config);
    expect(body.channel).toBe('zapi-web');
  });
  test('sendTemplate uses the common endpoint and canonical descriptor', async () => {
    fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      Response.json({ data: { messageId: 'remote-id', status: 'sent' } })) as unknown as typeof fetch);
    const body = {
      instanceId: 'local',
      to: '5511999999999',
      template: { name: 'notice', language: 'pt_BR', bodyParameters: ['Kelvin'] },
    };
    expect(await makeClient().messages.sendTemplate(body)).toEqual({ messageId: 'remote-id', status: 'sent' });
    expect(String(fetchMock.mock.calls[0][0])).toEndWith('/api/v2/messages/send/template');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
  });
  test('missing data cannot fabricate a successful template send', async () => {
    fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      Response.json({})) as unknown as typeof fetch);
    await expect(
      makeClient().messages.sendTemplate({
        instanceId: 'local',
        to: '5511999999999',
        template: { name: 'notice', language: 'pt_BR' },
      }),
    ).rejects.toThrow('Invalid template send response');
  });
});
