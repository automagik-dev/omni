/** Real auth hints in isolated children; recovery never touches real PM2, APIs or user config. */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const authPath = fileURLToPath(new URL('../auth.ts', import.meta.url));
const clientPath = fileURLToPath(new URL('../../client.ts', import.meta.url));
const pm2Path = fileURLToPath(new URL('../../pm2.ts', import.meta.url));

type Scenario = 'missing-auth' | 'missing-pm2' | 'failed-rotation';

async function hint(scenario: Scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-auth-hints-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      servers: {
        active: 'prod',
        list: { default: { url: 'http://localhost:8882' }, prod: { url: 'https://prod.invalid' } },
      },
    }),
  );
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
import { mock } from 'bun:test';
mock.module('@omni/sdk', () => ({ createOmniClient: () => { throw new Error('unexpected API call'); } }));
mock.module(${JSON.stringify(pm2Path)}, () => ({
  PM2_PROCESSES: { api: 'omni-api' },
  isPm2Available: async () => ${scenario === 'failed-rotation'},
  capturePm2: async () => ({ code: 0, stdout: '[]' }),
  runPm2: async () => { throw new Error('unexpected PM2 call'); },
}));
${
  scenario === 'missing-auth'
    ? `const { exitNotAuthenticated } = await import(${JSON.stringify(clientPath)}); exitNotAuthenticated();`
    : `const { createAuthCommand } = await import(${JSON.stringify(authPath)});
await createAuthCommand().parseAsync(['recover', ${scenario === 'failed-rotation' ? "'--rotate'" : ''}], { from: 'user' });`
}
`,
    ],
    {
      env: { PATH: process.env.PATH, HOME: dir, OMNI_CONFIG_DIR: dir, OMNI_FORMAT: 'human' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('credential hints without keys on argv', () => {
  test('missing credentials offer interactive or stdin login for the selected server', async () => {
    const result = await hint('missing-auth');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Not authenticated for server "prod" (https://prod.invalid).');
    expect(result.stderr).toContain('Sign in interactively: omni auth login --server prod');
    expect(result.stderr).toContain(
      'Or read a key from stdin: omni auth login --server prod --api-key-stdin < /secure/path/omni-api-key',
    );
    expect(result.stdout + result.stderr).not.toMatch(/--api-key(?:\s|=)/);
  });

  for (const scenario of ['missing-pm2', 'failed-rotation'] as const) {
    test(`${scenario} recovery offers interactive or stdin login for the local default entry`, async () => {
      const result = await hint(scenario);
      expect(result.exitCode).toBe(scenario === 'missing-pm2' ? 1 : 0);
      expect(result.stdout).toContain('Manual recovery steps:');
      expect(result.stdout.match(/Sign in interactively: omni auth login --server default/g)).toHaveLength(2);
      expect(
        result.stdout.match(
          /Or read a key from stdin: omni auth login --server default --api-key-stdin < \/secure\/path\/omni-api-key/g,
        ),
      ).toHaveLength(2);
      expect(result.stdout + result.stderr).not.toMatch(/--api-key(?:\s|=)/);
      expect(result.stdout).not.toContain('omni auth login --server prod');
    });
  }
});
