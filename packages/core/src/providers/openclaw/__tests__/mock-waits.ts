import { test as bunTest } from 'bun:test';

// Keep a diagnostic condition deadline inside the runner's deadline. This is local
// to these mock-socket tests; it does not change Bun's process-wide default timeout.
export function test(name: string, run: () => void | Promise<void>) {
  return bunTest(name, run, 15_000);
}

export async function waitForCondition(done: () => boolean, description: string): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!done()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
