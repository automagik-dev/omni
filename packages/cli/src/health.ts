/**
 * Health Check Utilities
 *
 * Shared health-check polling used by server, install, and update commands.
 */

export const DEFAULT_API_PORT = 8882;
export const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 500;

/** Build the health-check URL for a given port */
export function getHealthCheckUrl(port: number): string {
  return `http://localhost:${port}/api/v2/health`;
}

/** Wait for the health endpoint to respond (up to timeoutMs, default HEALTH_TIMEOUT_MS) */
export async function waitForHealth(port: number, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  const healthCheckUrl = getHealthCheckUrl(port);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(healthCheckUrl, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) return true;
    } catch {
      // keep polling
    }
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}
