/** Bot construction is local: no init/start or Telegram requests. */
import { expect, spyOn, test } from 'bun:test';
import { createBot, destroyBot } from '../client';

test('grammY API requests use a 45s timeout and do not pool idle sockets', async () => {
  const id = crypto.randomUUID();
  const bot = await createBot(id, '123456:local-test-token');
  const stop = spyOn(bot, 'stop').mockImplementation(() => {});
  try {
    // grammY retains the actual constructor options on Api (protected in its TS API).
    const api = bot.api as unknown as { options: { timeoutSeconds: number; baseFetchConfig: { agent: unknown } } };
    expect(api.options.timeoutSeconds).toBe(45);
    expect(api.options.timeoutSeconds).toBeGreaterThan(30); // default getUpdates long poll
    expect(api.options.baseFetchConfig.agent).toBe(false);
  } finally {
    destroyBot(id);
    stop.mockRestore();
  }
});
