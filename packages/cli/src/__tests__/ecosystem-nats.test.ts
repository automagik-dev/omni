/**
 * Repo dev PM2 config (ecosystem.config.cjs) — managed NATS args
 *
 * The ecosystem file is env-driven CommonJS evaluated by PM2 at load time,
 * so each case loads a fresh copy under a controlled environment and reads
 * the `omni-v2-nats` app it produces. It lives at the repo root; this suite
 * sits in the CLI package because the CLI owns the managed-NATS defaults it
 * mirrors (DEFAULT_NATS_HOST).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_NATS_HOST } from '../nats-server-args.js';

const ECOSYSTEM_PATH = fileURLToPath(new URL('../../../../ecosystem.config.cjs', import.meta.url));
const requireCjs = createRequire(import.meta.url);

/** Env vars the ecosystem reads for the NATS app — saved and restored around each test. */
const MANAGED_ENV = ['NATS_MANAGED', 'API_MANAGED', 'NATS_HOST', 'NATS_PORT'] as const;

interface EcosystemApp {
  name: string;
  args: string;
}

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of MANAGED_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_ENV) {
    const previous = savedEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  delete requireCjs.cache[ECOSYSTEM_PATH];
});

/** Evaluate a fresh copy of ecosystem.config.cjs under the given env. */
function loadEcosystem(env: Partial<Record<(typeof MANAGED_ENV)[number], string>>): EcosystemApp[] {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  delete requireCjs.cache[ECOSYSTEM_PATH];
  return (requireCjs(ECOSYSTEM_PATH) as { apps: EcosystemApp[] }).apps;
}

function natsArgs(env: Partial<Record<(typeof MANAGED_ENV)[number], string>>): string[] {
  const app = loadEcosystem({ NATS_MANAGED: 'true', ...env }).find((a) => a.name === 'omni-v2-nats');
  if (!app) throw new Error('omni-v2-nats app not defined');
  return app.args.split(' ');
}

describe('ecosystem.config.cjs — omni-v2-nats', () => {
  test('defaults: JetStream, port 4222, bound to 127.0.0.1', () => {
    expect(natsArgs({})).toEqual(['-js', '-p', '4222', '-a', '127.0.0.1']);
  });

  test('fallback host matches the CLI default', () => {
    expect(natsArgs({})).toContain(DEFAULT_NATS_HOST);
  });

  test('NATS_HOST overrides the bind address', () => {
    expect(natsArgs({ NATS_HOST: '0.0.0.0' })).toEqual(['-js', '-p', '4222', '-a', '0.0.0.0']);
    expect(natsArgs({ NATS_HOST: '::' })).toEqual(['-js', '-p', '4222', '-a', '::']);
  });

  test('NATS_PORT still sets the port, independently of NATS_HOST', () => {
    expect(natsArgs({ NATS_PORT: '4223' })).toEqual(['-js', '-p', '4223', '-a', '127.0.0.1']);
    expect(natsArgs({ NATS_PORT: '4223', NATS_HOST: '10.0.0.5' })).toEqual(['-js', '-p', '4223', '-a', '10.0.0.5']);
  });

  test('an empty NATS_HOST falls back to 127.0.0.1', () => {
    expect(natsArgs({ NATS_HOST: '' })).toEqual(['-js', '-p', '4222', '-a', '127.0.0.1']);
  });

  test('a NATS_HOST that would smuggle extra arguments is rejected', () => {
    expect(() => natsArgs({ NATS_HOST: '0.0.0.0 -p 1' })).toThrow(/Invalid NATS_HOST/);
    expect(() => natsArgs({ NATS_HOST: '$(id)' })).toThrow(/Invalid NATS_HOST/);
  });

  test('a NATS_HOST that looks like a flag is rejected', () => {
    expect(() => natsArgs({ NATS_HOST: '-DV' })).toThrow(/Invalid NATS_HOST/);
    expect(() => natsArgs({ NATS_HOST: '--help' })).toThrow(/Invalid NATS_HOST/);
  });

  test('no NATS app when NATS_MANAGED is not true', () => {
    expect(loadEcosystem({}).some((a) => a.name === 'omni-v2-nats')).toBe(false);
  });
});
