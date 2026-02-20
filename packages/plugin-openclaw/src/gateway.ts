import type { ChannelGatewayContext } from './types.js';

const HEALTH_INTERVAL_MS = 30_000;

export async function startOmniAccount(ctx: ChannelGatewayContext): Promise<void> {
  const { accountId, account, abortSignal, log } = ctx;

  log?.info(`[${accountId}] omni: starting health monitor`);

  ctx.setStatus({
    accountId,
    running: true,
    lastStartAt: Date.now(),
    baseUrl: account.apiUrl,
  });

  const healthUrl = `${account.apiUrl}/health`;

  async function checkHealth(): Promise<void> {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        log?.warn(`[${accountId}] omni: health check returned ${response.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't crash on health check failure -- Omni may be restarting
      if (!abortSignal.aborted) {
        log?.warn(`[${accountId}] omni: health check failed: ${msg}`);
      }
    }
  }

  // Initial health check
  await checkHealth();

  // Periodic health checks
  const interval = setInterval(() => {
    if (abortSignal.aborted) return;
    void checkHealth();
  }, HEALTH_INTERVAL_MS);

  // Wait for abort signal to clean up
  return new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      clearInterval(interval);
      ctx.setStatus({
        accountId,
        running: false,
        lastStopAt: Date.now(),
      });
      resolve();
      return;
    }

    abortSignal.addEventListener(
      'abort',
      () => {
        clearInterval(interval);
        log?.info(`[${accountId}] omni: health monitor stopped`);
        ctx.setStatus({
          accountId,
          running: false,
          lastStopAt: Date.now(),
        });
        resolve();
      },
      { once: true },
    );
  });
}
