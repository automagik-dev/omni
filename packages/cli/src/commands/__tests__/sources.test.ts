/**
 * CLI `omni sources add <provider>` (#1074) — orchestration with the omni
 * client, schema registry and provider API all mocked.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PRESETS, type ProviderApi, StepFailure, addSource } from '../sources';

const github = PRESETS.github;

function mockDeps(
  opts: { existing?: boolean; failSchemas?: boolean; hooks?: Array<{ id: number; config: { url: string } }> } = {},
) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const providerCalls: Array<{ method: string; path: string; body?: unknown }> = [];
  const client = {
    listSources: async () => {
      calls.push({ op: 'listSources', args: [] });
      return opts.existing ? [{ id: 'src-existing', name: 'github' }] : [];
    },
    createSource: async (body: unknown) => {
      calls.push({ op: 'createSource', args: [body] });
      return { id: 'src-new' };
    },
    updateSource: async (id: string, body: unknown) => {
      calls.push({ op: 'updateSource', args: [id, body] });
      return { id };
    },
  } as never;
  const registerSchema = async (eventType: string, schema: Record<string, unknown>, description: string) => {
    if (opts.failSchemas) throw new Error('registry down');
    calls.push({ op: 'registerSchema', args: [eventType, schema, description] });
  };
  const providerApi: ProviderApi = async (method, path, body) => {
    providerCalls.push({ method, path, body });
    if (method === 'GET') return opts.hooks ?? [];
    return { id: 99 };
  };
  return { calls, providerCalls, client, registerSchema, providerApi: async () => providerApi };
}

const base = { preset: github, target: 'octo/repo', secret: 's'.repeat(32), publicUrl: 'https://omni.example.com/' };

describe('addSource', () => {
  test('creates the source, sets template + mapping, registers schemas, creates the provider hook', async () => {
    const deps = mockDeps();
    const result = await addSource({ ...base, events: ['push', 'pull_request'], providerWebhook: true, ...deps });

    expect(result).toMatchObject({
      sourceId: 'src-new',
      created: true,
      webhookUrl: 'https://omni.example.com/api/v2/webhooks/ingress/github',
      providerHookId: '99',
      completed: ['source', 'idempotency', 'event-type-mapping', 'schemas', 'provider-webhook'],
    });
    expect(deps.calls.map((c) => c.op)).toEqual([
      'listSources',
      'createSource',
      'updateSource',
      'updateSource',
      'registerSchema',
      'registerSchema',
    ]);
    expect(deps.calls[1].args[0]).toMatchObject({
      name: 'github',
      signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256', prefix: 'sha256=' },
      signatureSecret: base.secret,
      expectedIntervalSeconds: 86400,
    });
    expect(deps.calls[2].args[1]).toEqual({ idempotencyKeyTemplate: 'github:{headers.x-github-delivery}' });
    expect(deps.calls[3].args[1]).toEqual({ eventTypeMapping: { source: 'header', header: 'X-GitHub-Event' } });
    expect(deps.calls[4].args[0]).toBe('custom.github.push');
    expect(deps.calls[5].args[0]).toBe('custom.github.pull_request');
    expect(deps.providerCalls).toEqual([
      { method: 'GET', path: '/repos/octo/repo/hooks', body: undefined },
      {
        method: 'POST',
        path: '/repos/octo/repo/hooks',
        body: {
          name: 'web',
          active: true,
          events: ['push', 'pull_request'],
          config: {
            url: 'https://omni.example.com/api/v2/webhooks/ingress/github',
            content_type: 'json',
            secret: base.secret,
            insecure_ssl: '0',
          },
        },
      },
    ]);
  });

  test('re-run updates the existing source and PATCHes the matching provider hook', async () => {
    const hookUrl = 'https://omni.example.com/api/v2/webhooks/ingress/github';
    const deps = mockDeps({
      existing: true,
      hooks: [
        { id: 7, config: { url: 'https://other' } },
        { id: 8, config: { url: hookUrl } },
      ],
    });
    const result = await addSource({ ...base, events: ['push'], providerWebhook: true, ...deps });

    expect(result.created).toBe(false);
    expect(result.sourceId).toBe('src-existing');
    expect(result.providerHookId).toBe('8');
    expect(deps.calls.map((c) => c.op)).not.toContain('createSource');
    expect(deps.providerCalls[1]).toMatchObject({ method: 'PATCH', path: '/repos/octo/repo/hooks/8' });
  });

  test('--no-provider-webhook skips step 5 and never touches the provider', async () => {
    const deps = mockDeps();
    const result = await addSource({ ...base, events: ['push'], providerWebhook: false, ...deps });
    expect(result.completed).toEqual(['source', 'idempotency', 'event-type-mapping', 'schemas']);
    expect(result.providerHookId).toBeUndefined();
    expect(deps.providerCalls).toEqual([]);
  });

  test('a failing step reports which steps completed', async () => {
    const deps = mockDeps({ failSchemas: true });
    const err = await addSource({ ...base, events: ['push'], providerWebhook: true, ...deps }).catch((e) => e);
    expect(err).toBeInstanceOf(StepFailure);
    expect(err.step).toBe('schemas');
    expect(err.completed).toEqual(['source', 'idempotency', 'event-type-mapping']);
    expect(err.message).toBe('registry down');
    expect(deps.providerCalls).toEqual([]);
  });

  test('rejects unknown events and malformed repos before any call', async () => {
    const deps = mockDeps();
    await expect(addSource({ ...base, events: ['stars'], providerWebhook: true, ...deps })).rejects.toThrow(
      'unknown github events: stars',
    );
    expect(deps.calls).toEqual([]);
    await expect(
      github.ensureProviderWebhook(deps.providerApi as never, 'not-a-repo', { url: '', secret: '', events: [] }),
    ).rejects.toThrow('--repo must be OWNER/NAME');
  });
});

describe('bundled GitHub schema presets', () => {
  test('are byte-identical to the runbook artifacts in docs/examples/event-schemas/github', () => {
    const docsDir = join(import.meta.dir, '../../../../../docs/examples/event-schemas/github');
    const presetDir = join(import.meta.dir, '../sources/github');
    const files = readdirSync(docsDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(Object.keys(github.schemas).length);
    for (const file of files) {
      expect(readFileSync(join(presetDir, file), 'utf-8')).toBe(readFileSync(join(docsDir, file), 'utf-8'));
    }
  });
});
