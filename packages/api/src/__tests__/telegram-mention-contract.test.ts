/** Cross-package contract, isolated from process-wide provider/channel module mocks. */
import { expect, test } from 'bun:test';

test('Telegram producer mentions survive journal persistence and match DSH subscriptions', async () => {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/fixtures/telegram-mention-contract.ts`], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LOG_LEVEL: 'silent' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Telegram mention contract exited ${code}: ${stderr}`);
    expect(stdout.trim()).toBe('Telegram producer → journal → DSH: 8 cases passed');
  } finally {
    child.kill();
    await child.exited;
  }
}, 15_000);
