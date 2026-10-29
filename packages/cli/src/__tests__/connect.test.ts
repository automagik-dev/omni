import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { OmniClient } from '@omni/sdk';
import { createConnectCommand, runGenieConnect } from '../commands/connect.js';
import { discoverGenieAgent } from '../connect-preflight.js';
import * as output from '../output.js';

const entry = { name: 'sample', dir: '/agents/sample' };
const options = { mode: 'turn-based', replyFilter: 'all' } as const;
const provider = {
  id: 'provider',
  name: 'nats-genie-sample',
  schema: 'nats-genie',
  baseUrl: 'nats://127.0.0.1:14222',
  schemaConfig: { agentName: 'sample', agentDir: entry.dir, natsUrl: '127.0.0.1:14222' },
};

function fixture(existing: unknown[] = []) {
  const calls: { method: string; value?: unknown }[] = [];
  const messages: string[] = [];
  const client = {
    providers: {
      list: async () => {
        calls.push({ method: 'providers.list' });
        return existing;
      },
      create: async (value: unknown) => {
        calls.push({ method: 'providers.create', value });
        return { id: provider.id, ...(value as object) };
      },
    },
    agents: {
      create: async (value: unknown) => {
        calls.push({ method: 'agents.create', value });
        return { id: 'agent' };
      },
    },
    instances: {
      get: async () => {
        calls.push({ method: 'instances.get' });
        return {};
      },
      update: async (_id: string, value: unknown) => {
        calls.push({ method: 'instances.update', value });
        return {};
      },
    },
  } as unknown as OmniClient;
  const deps = {
    client: () => {
      calls.push({ method: 'client' });
      return client;
    },
    discover: () => entry,
    nats: (_override?: string) => provider.baseUrl,
    output: {
      ...output,
      error: (message: string): never => {
        throw new Error(message);
      },
      info: (message: string) => {
        messages.push(message);
      },
      success: (message: string) => {
        messages.push(message);
      },
      header: (message: string) => {
        messages.push(message);
      },
      keyValue: (key: string, value: unknown) => {
        messages.push(`${key}: ${value}`);
      },
    },
    link: async ({ url }: { url?: string }) => {
      calls.push({ method: 'link', value: url });
    },
  };
  return { calls, messages, deps, client };
}

describe('connect compatibility and failure behavior', () => {
  test('unsupported Genie exits nonzero with actionable JSON in a real subprocess', () => {
    const command = resolve(import.meta.dir, '../commands/connect.ts');
    const preflight = resolve(import.meta.dir, '../connect-preflight.ts');
    const script = `import { createConnectCommand } from ${JSON.stringify(command)};
      import { discoverGenieAgent } from ${JSON.stringify(preflight)};
      await createConnectCommand({
        client: () => { throw new Error('API access forbidden'); },
        discover: name => discoverGenieAgent(name, args => {
          if (args.join(' ') === '--version') return '6.261015.3';
          if (args.join(' ') === '--help') return 'Commands:\\n  board    Board\\n  task    Tasks\\n';
          throw new Error('Unsupported command forbidden');
        })
      }).parseAsync(['instance', 'sample'], { from: 'user' });`;
    const result = spawnSync(process.execPath, ['--eval', script], {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, OMNI_FORMAT: 'json' },
    });
    expect(result.status).toBe(1);
    const message = JSON.parse(result.stderr).error;
    expect(message).toContain('6.261015.3');
    expect(message).toContain('genie --help');
    expect(message).not.toMatch(/genie (serve|dir add|omni start)|API access forbidden/);
    expect(result.stdout).toBe('');
  });
  test('Genie 6 fails before client construction or mutations', async () => {
    const f = fixture();
    f.deps.discover = () =>
      discoverGenieAgent('sample', (args) =>
        args[0] === '--version' ? '6.261015.3' : 'Commands:\n  board   Board\n  task   Tasks\n',
      );
    await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow('6.261015.3');
    expect(f.calls).toEqual([]);
  });
  test('NATS preflight errors precede authentication/client construction', async () => {
    const f = fixture();
    f.deps.nats = () => {
      throw new Error('Supply --nats-url');
    };
    await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow('--nats-url');
    expect(f.calls).toEqual([]);
  });
  test('an unreadable instance prevents any provider mutation', async () => {
    const f = fixture();
    f.client.instances.get = async () => {
      throw new Error('Not found or forbidden');
    };
    await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow('Could not read instance');
    expect(f.calls.map((c) => c.method)).toEqual(['client']);
  });
  test('provider lookup failure is not treated as absence', async () => {
    const f = fixture();
    f.client.providers.list = async () => {
      throw new Error('Forbidden');
    };
    await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow('Could not inspect');
    expect(f.calls.some((c) => c.method.endsWith('.create') || c.method.endsWith('.update'))).toBe(false);
  });
  test('instance update failure does not report success', async () => {
    const f = fixture();
    f.client.instances.update = async () => {
      throw new Error('Forbidden');
    };
    await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow(
      'Provider/agent records may exist',
    );
    expect(f.messages.join('\n')).not.toContain('Configured instance');
  });
});

describe('connect provider and instance wiring', () => {
  test.each(['turn-based', 'fire-and-forget'] as const)(
    'sets canonical provider, agent FK, filter and mode %s',
    async (mode) => {
      const f = fixture();
      await runGenieConnect('instance', 'sample', { ...options, mode, replyFilter: 'filtered' }, f.deps);
      expect(f.calls.find((c) => c.method === 'providers.create')?.value).toEqual({
        name: provider.name,
        schema: 'nats-genie',
        baseUrl: provider.baseUrl,
        schemaConfig: { ...provider.schemaConfig, natsUrl: provider.baseUrl },
      });
      expect(f.calls.find((c) => c.method === 'agents.create')?.value).toMatchObject({
        name: 'sample',
        agentProviderId: 'provider',
        provider: 'custom',
      });
      expect(f.calls.find((c) => c.method === 'instances.update')?.value).toEqual({
        agentId: 'agent',
        agentReplyFilter: { mode: 'filtered', conditions: {} },
        triggerMode: mode === 'turn-based' ? 'round-trip' : 'fire-and-forget',
      });
      expect(f.messages.join('\n')).not.toMatch(/genie (serve|dir add|omni start)/);
      expect(f.messages.join('\n')).toContain('not started or verified');
    },
  );
  test('equivalent existing provider is reused without rewriting configuration', async () => {
    const f = fixture([provider]);
    await runGenieConnect('instance', 'sample', options, f.deps);
    expect(f.calls.some((c) => c.method === 'providers.create')).toBe(false);
    expect(f.calls.some((c) => c.method === 'instances.update')).toBe(true);
  });
  test.each([
    { ...provider, schemaConfig: { ...provider.schemaConfig, natsUrl: 'localhost:4222' } },
    { ...provider, schemaConfig: { ...provider.schemaConfig, agentName: 'other' } },
    { ...provider, schemaConfig: { ...provider.schemaConfig, agentDir: '/other' } },
    { ...provider, baseUrl: 'nats://localhost:4222' },
  ])('conflicting existing provider prevents mutations %j', async (existing) => {
    const f = fixture([existing]);
    await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow('reconcile it explicitly');
    expect(f.calls.map((c) => c.method)).toEqual(['client', 'instances.get', 'providers.list']);
  });
  test.each([true, false])('validates concurrent creation collision (matching=%s)', async (matching) => {
    const f = fixture();
    let lists = 0;
    f.client.providers.list = async () =>
      ++lists === 1 ? [] : ([matching ? provider : { ...provider, schemaConfig: {} }] as never);
    f.client.providers.create = async () => {
      throw new Error('Conflict');
    };
    if (matching) {
      await runGenieConnect('instance', 'sample', options, f.deps);
      expect(f.calls.some((c) => c.method === 'instances.update')).toBe(true);
    } else {
      await expect(runGenieConnect('instance', 'sample', options, f.deps)).rejects.toThrow('reconcile it explicitly');
      expect(f.calls.some((c) => c.method === 'agents.create' || c.method === 'instances.update')).toBe(false);
    }
  });
  test('transport/auth URL reaches both provider fields without being printed', async () => {
    const f = fixture();
    const broker = 'tls://user:secret@broker:4222';
    f.deps.nats = () => broker;
    await runGenieConnect('instance', 'sample', options, f.deps);
    expect(f.calls.find((c) => c.method === 'providers.create')?.value).toMatchObject({
      baseUrl: broker,
      schemaConfig: { natsUrl: broker },
    });
    expect(f.messages.join('\n')).not.toContain('secret');
  });
});

describe('connect command parsing and device pairing', () => {
  test('no arguments invokes only owner link; partial arguments fail', async () => {
    const f = fixture();
    await createConnectCommand(f.deps).parseAsync(['--url', 'https://omni.example'], { from: 'user' });
    expect(f.calls).toEqual([{ method: 'link', value: 'https://omni.example' }]);
    await expect(createConnectCommand(f.deps).parseAsync(['instance'], { from: 'user' })).rejects.toThrow('Give both');
    expect(f.calls).toHaveLength(1);
  });
  test('forwards explicit NATS override and retains all/turn-based defaults', async () => {
    const f = fixture();
    let received: string | undefined;
    f.deps.nats = (override?: string) => {
      received = override;
      return provider.baseUrl;
    };
    await createConnectCommand(f.deps).parseAsync(['instance', 'sample', '--nats-url', 'nats://broker:14223'], {
      from: 'user',
    });
    expect(received).toBe('nats://broker:14223');
    expect(f.calls.find((c) => c.method === 'instances.update')?.value).toEqual({
      agentId: 'agent',
      agentReplyFilter: { mode: 'all', conditions: {} },
      triggerMode: 'round-trip',
    });
  });
  test('help explains metadata defaults and the remote override', () => {
    const help = createConnectCommand().helpInformation().replace(/\s+/g, ' ');
    expect(help).toContain('sandbox metadata');
    expect(help).toContain('remote targets');
    expect(createConnectCommand().options.find((o) => o.long === '--nats-url')?.defaultValue).toBeUndefined();
  });
});
