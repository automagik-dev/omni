import { test as bunTest } from 'bun:test';

// Keep a diagnostic condition deadline inside the runner's deadline. This is local
// to these mock-socket tests; it does not change Bun's process-wide default timeout.
export function test(name: string, run: () => void | Promise<void>) {
  return bunTest(name, run, 15_000);
}

export async function waitForCondition(
  done: () => boolean | Promise<boolean>,
  description: string | (() => string),
): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!(await done())) {
    if (performance.now() >= deadline)
      throw new Error(`Timed out waiting for ${typeof description === 'function' ? description() : description}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Verify the listener accepts HTTP before starting a WebSocket client. */
export async function waitForMockServer(url: URL): Promise<void> {
  let lastError: unknown;
  await waitForCondition(
    async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(500) });
        lastError = `HTTP ${response.status}`;
        return response.status === 404;
      } catch (error) {
        lastError = error;
        return false;
      }
    },
    () => `the mock HTTP listener at ${url}: ${String(lastError)}`,
  );
}
