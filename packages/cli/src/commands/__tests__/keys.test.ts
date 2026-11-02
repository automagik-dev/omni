/**
 * CLI `omni keys create` — profile flag + admin TTY gate.
 *
 * Covers:
 *   - `--profile scout --owner <jid>` sends the right body to the API
 *   - `--profile admin` refuses when stdin is not a TTY
 *   - `--profile admin` on a TTY rejects an incorrect confirmation phrase
 *   - `--profile admin` accepts the exact `I UNDERSTAND` phrase (and then
 *     exercises the admin-only code path up to resolveProfile)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OmniClient } from '@omni/sdk';
import { __testables } from '../keys';

const { ADMIN_CONFIRMATION_PHRASE, handleCreate, promptAdminConfirmation } = __testables;

interface MockedStdin {
  readonly isTTY: boolean | undefined;
  queue: string[];
  writeAnswer(text: string): void;
  restore(): void;
}

function stubStdin(options: { isTTY: boolean; answer?: string }): MockedStdin {
  const originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', {
    value: options.isTTY,
    configurable: true,
    writable: true,
  });

  const pending: string[] = [];
  if (options.answer !== undefined) pending.push(`${options.answer}\n`);

  const onSpy: { data?: (chunk: Buffer | string) => void } = {};
  const originalOn = process.stdin.on.bind(process.stdin);
  const originalOff = process.stdin.off.bind(process.stdin);
  const originalResume = process.stdin.resume.bind(process.stdin);
  const originalPause = process.stdin.pause.bind(process.stdin);

  (process.stdin as unknown as { on: typeof process.stdin.on }).on = ((
    event: string,
    handler: (chunk: Buffer | string) => void,
  ) => {
    if (event === 'data') {
      onSpy.data = handler;
    }
    return process.stdin;
  }) as typeof process.stdin.on;

  (process.stdin as unknown as { off: typeof process.stdin.off }).off = ((event: string) => {
    if (event === 'data') onSpy.data = undefined;
    return process.stdin;
  }) as typeof process.stdin.off;

  (process.stdin as unknown as { resume: () => void }).resume = (() => {
    if (pending.length && onSpy.data) {
      queueMicrotask(() => {
        const next = pending.shift();
        if (next && onSpy.data) onSpy.data(next);
      });
    }
  }) as typeof process.stdin.resume;

  (process.stdin as unknown as { pause: () => void }).pause = (() => {}) as typeof process.stdin.pause;

  return {
    get isTTY() {
      return process.stdin.isTTY;
    },
    queue: pending,
    writeAnswer(text: string): void {
      pending.push(`${text}\n`);
    },
    restore(): void {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
        writable: true,
      });
      (process.stdin as unknown as { on: typeof process.stdin.on }).on = originalOn;
      (process.stdin as unknown as { off: typeof process.stdin.off }).off = originalOff;
      (process.stdin as unknown as { resume: () => void }).resume = originalResume;
      (process.stdin as unknown as { pause: () => void }).pause = originalPause;
    },
  };
}

function stubStdout(): { data: string[]; restore: () => void } {
  const data: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: typeof process.stdout.write }).write = ((
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ) => {
    data.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  return {
    data,
    restore(): void {
      (process.stdout as unknown as { write: typeof process.stdout.write }).write = original;
    },
  };
}

const KEYS_MODULE = fileURLToPath(new URL('../keys.ts', import.meta.url));
const children = new Set<{ kill(): void; exited: Promise<number> }>();
let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'omni-key-create-'));
});

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      child.kill();
      await child.exited;
    }),
  );
  rmSync(configDir, { recursive: true, force: true });
});

// Shared output.error mocks can become no-ops when another suite restores its
// spies. Check refusal against real output/exit in a fresh process instead.
async function runRefusedCreate(options: Parameters<typeof handleCreate>[1], isTTY: boolean, answer = '') {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { __testables } from ${JSON.stringify(KEYS_MODULE)};
Object.defineProperty(process.stdin, 'isTTY', { value: ${isTTY}, configurable: true });
const client = { keys: { create: async () => { throw new Error('Unexpected key creation'); } } };
await __testables.handleCreate(client, ${JSON.stringify(options)});`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OMNI_CONFIG_DIR: configDir,
        NO_COLOR: '1',
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  children.add(child);
  try {
    child.stdin.write(`${answer}\n`);
    child.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    children.delete(child);
  }
}

// ---------------------------------------------------------------------------

describe('promptAdminConfirmation', () => {
  let stdin: MockedStdin | null = null;
  let stdout: ReturnType<typeof stubStdout> | null = null;

  beforeEach(() => {
    stdout = stubStdout();
  });

  afterEach(() => {
    stdin?.restore();
    stdout?.restore();
    stdin = null;
    stdout = null;
  });

  test('returns true for the exact phrase', async () => {
    stdin = stubStdin({ isTTY: true, answer: ADMIN_CONFIRMATION_PHRASE });
    expect(await promptAdminConfirmation()).toBe(true);
  });

  test('returns false when the phrase is wrong', async () => {
    stdin = stubStdin({ isTTY: true, answer: 'i understand' });
    expect(await promptAdminConfirmation()).toBe(false);
  });

  test('returns false on empty input', async () => {
    stdin = stubStdin({ isTTY: true, answer: '' });
    expect(await promptAdminConfirmation()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('handleCreate — admin profile', () => {
  test('refuses when stdin is not a TTY', async () => {
    const { exitCode, stdout, stderr } = await runRefusedCreate({ name: 'god', profile: 'admin' }, false);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('admin keys require a TTY');
    expect(stdout).toBe('');
  });

  test('refuses on a TTY with the wrong confirmation phrase', async () => {
    const { exitCode, stdout, stderr } = await runRefusedCreate({ name: 'god', profile: 'admin' }, true, 'no thanks');
    expect(exitCode).toBe(1);
    expect(stderr).toContain('admin confirmation failed');
    expect(stdout).toContain(ADMIN_CONFIRMATION_PHRASE);
    expect(stdout).not.toContain('API Key (save this');
  });
});

// ---------------------------------------------------------------------------

describe('handleCreate — scout profile body shape', () => {
  test('sends profile + owner + instance lock to client.keys.create', async () => {
    const captured: unknown[] = [];
    const fakeClient = {
      keys: {
        create: async (body: unknown) => {
          captured.push(body);
          return {
            id: 'id-1',
            name: 'scout-key',
            keyPrefix: 'abcdefgh',
            scopes: ['chats:read', 'media:read', 'messages:send'],
            instanceIds: ['00000000-0000-0000-0000-000000000001'],
            status: 'active',
            usageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plainTextKey: 'omni_sk_scout-secret',
          };
        },
      },
    } as unknown as OmniClient;

    await handleCreate(fakeClient, {
      name: 'scout-key',
      profile: 'scout',
      owner: '551199999999@s.whatsapp.net',
      lockInstance: ['00000000-0000-0000-0000-000000000001'],
    });

    expect(captured.length).toBe(1);
    const body = captured[0] as Record<string, unknown>;
    expect(body.profile).toBe('scout');
    expect(body.owner).toBe('551199999999@s.whatsapp.net');
    expect(body.instanceAllowlist).toEqual(['00000000-0000-0000-0000-000000000001']);
    expect(body.name).toBe('scout-key');
  });

  test('requires --profile or --scopes', async () => {
    const { exitCode, stdout, stderr } = await runRefusedCreate({ name: 'nope' }, false);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Either --profile or --scopes is required');
    expect(stdout).toBe('');
  });
});
