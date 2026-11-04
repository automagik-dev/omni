/** Real auth hints in isolated children; recovery never touches real PM2, APIs or user config. */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const authPath = fileURLToPath(new URL('../auth.ts', import.meta.url));
const clientPath = fileURLToPath(new URL('../../client.ts', import.meta.url));
const serverPath = fileURLToPath(new URL('../server.ts', import.meta.url));
const configPath = fileURLToPath(new URL('../config.ts', import.meta.url));
const pm2Path = fileURLToPath(new URL('../../pm2.ts', import.meta.url));

type Scenario =
  | 'missing-auth'
  | 'missing-pm2'
  | 'failed-rotation'
  | 'auth-status'
  | 'server-add'
  | 'config-key'
  | 'server-remove';

function invocation(scenario: Scenario, name: string): string {
  if (scenario === 'missing-auth') {
    return `const { exitNotAuthenticated } = await import(${JSON.stringify(clientPath)}); exitNotAuthenticated();`;
  }
  const commands = {
    'missing-pm2': [authPath, 'createAuthCommand', ['recover']],
    'failed-rotation': [authPath, 'createAuthCommand', ['recover', '--rotate']],
    'auth-status': [authPath, 'createAuthCommand', ['status']],
    'server-add': [serverPath, 'createServerCommand', ['add', name, 'https://prod.invalid', '--skip-verify']],
    'server-remove': [serverPath, 'createServerCommand', ['remove', name]],
    'config-key': [configPath, 'createConfigCommand', ['get', 'servers.active']],
  } as const;
  const [path, factory, args] = commands[scenario];
  return `const { ${factory} } = await import(${JSON.stringify(path)});
await ${factory}().parseAsync(${JSON.stringify(args)}, { from: 'user' });`;
}

async function hint(scenario: Scenario, name = 'prod', json = false) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-auth-hints-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      servers: {
        active: name,
        list: {
          ...(scenario === 'server-remove' ? {} : { default: { url: 'http://localhost:8882' } }),
          [name]: { url: 'https://prod.invalid' },
        },
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
${invocation(scenario, name)}
`,
    ],
    {
      env: { PATH: process.env.PATH, HOME: dir, OMNI_CONFIG_DIR: dir, OMNI_FORMAT: json ? 'json' : 'human' },
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
    const savedKey: unknown = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).servers.list.default?.apiKey;
    return { exitCode, stdout, stderr, savedKey };
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
      expect(result.stdout.includes('omni server list --reveal')).toBe(scenario === 'failed-rotation');
    });
  }
});

describe('shell-safe credential hint leftovers', () => {
  const name = "prod team; $HOME's";
  const quoted = "'prod team; $HOME'\\''s'";

  test('missing credentials quote the selected server in both login commands', async () => {
    const result = await hint('missing-auth', name);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`Sign in interactively: omni auth login --server ${quoted}`);
    expect(result.stderr).toContain(`Or read a key from stdin: omni auth login --server ${quoted} --api-key-stdin`);
  });

  test('auth status quotes the selected server in its login command', async () => {
    const result = await hint('auth-status', name);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`omni auth login --server ${quoted} --api-key-stdin`);
  });

  test('keyless server add quotes the name in both login commands', async () => {
    const result = await hint('server-add', name);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Sign in interactively: omni auth login --server ${quoted}`);
    expect(result.stdout).toContain(`Or read a key from stdin: omni auth login --server ${quoted} --api-key-stdin`);
  });

  test('config registry errors suggest keyless add and scoped interactive or stdin login', async () => {
    const result = await hint('config-key', name, true);
    expect(result.exitCode).toBe(1);
    const { details } = JSON.parse(result.stderr);
    expect(details.use).toContain('omni server add <name> <url>');
    expect(details.use).toContain(`Sign in interactively: omni auth login --server ${quoted}`);
    expect(details.use).toContain(
      `Or read a key from stdin: omni auth login --server ${quoted} --api-key-stdin < /secure/path/omni-api-key`,
    );
    expect(result.stdout + result.stderr).not.toMatch(/--api-key(?:\s|=)/);
  });

  test('the last-server replacement hint quotes the server name', async () => {
    const result = await hint('server-remove', name, true);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).details.hint).toBe(
      `Point it somewhere else instead: omni server add ${quoted} <url>`,
    );
  });
});

// Process-spawning regressions need headroom on loaded CI workers.
for (const json of [false, true]) {
  test(`failed rotation hides the generated key in ${json ? 'JSON' : 'human'} output`, async () => {
    const result = await hint('failed-rotation', 'prod', json);
    expect(result.exitCode).toBe(0);
    const key = result.savedKey;
    if (typeof key !== 'string') throw new Error('Failed rotation must save the generated key in the local entry');
    expect(key).toMatch(/^omni_sk_[0-9a-f]{32}$/);
    const printed = result.stdout + result.stderr;
    expect(printed).not.toContain(key);
    expect(result.stdout).toContain('c. Restart:       OMNI_API_KEY=<your-new-key> omni start');
    expect(result.stdout).toContain('omni server list --reveal');
    expect(printed).toContain(`Config updated with new key (${key.slice(0, 12)}...) but API restart failed.`);
  }, 30_000);
}
