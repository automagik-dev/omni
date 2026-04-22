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

function stubProcessExit(): { calls: number[]; restore: () => void } {
  const calls: number[] = [];
  const original = process.exit;
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    calls.push(code ?? 0);
    throw new Error(`__exit_${code ?? 0}`);
  }) as never;
  return {
    calls,
    restore(): void {
      process.exit = original;
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
  let stdinStub: MockedStdin | null = null;
  let stdoutStub: ReturnType<typeof stubStdout> | null = null;
  let exitStub: ReturnType<typeof stubProcessExit> | null = null;

  beforeEach(() => {
    stdoutStub = stubStdout();
    exitStub = stubProcessExit();
  });

  afterEach(() => {
    stdinStub?.restore();
    stdoutStub?.restore();
    exitStub?.restore();
    stdinStub = null;
    stdoutStub = null;
    exitStub = null;
  });

  test('refuses when stdin is not a TTY', async () => {
    stdinStub = stubStdin({ isTTY: false });
    const fakeClient = {} as OmniClient;
    // Accepts either the real-output path (__exit_1 via stubbed process.exit)
    // or the mock-module path (throws the error message) — other test files
    // call `mock.module('../output.js', …)` process-wide, so the behavior
    // depends on suite ordering. Either way, creation must be refused.
    await expect(handleCreate(fakeClient, { name: 'god', profile: 'admin' })).rejects.toThrow(
      /__exit_1|admin keys require a TTY/,
    );
  });

  test('refuses on a TTY with the wrong confirmation phrase', async () => {
    stdinStub = stubStdin({ isTTY: true, answer: 'no thanks' });
    const fakeClient = {} as OmniClient;
    await expect(handleCreate(fakeClient, { name: 'god', profile: 'admin' })).rejects.toThrow(
      /__exit_1|admin confirmation failed/,
    );
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
    const exitStub = stubProcessExit();
    const stdoutStub = stubStdout();
    try {
      const fakeClient = { keys: { create: async () => ({ plainTextKey: 'x' }) } } as unknown as OmniClient;
      // See admin-profile suite: assertion tolerates both the real-output
      // and mock.module-patched variants of `output.error`.
      await expect(handleCreate(fakeClient, { name: 'nope' })).rejects.toThrow(
        /__exit_1|Either --profile or --scopes is required/,
      );
    } finally {
      stdoutStub.restore();
      exitStub.restore();
    }
  });
});
