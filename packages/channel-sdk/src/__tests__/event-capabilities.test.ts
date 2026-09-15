/**
 * Keeps `capabilities.events` honest (issue #1187): statically scans each
 * channel package for what it publishes and fails when the declaration
 * disagrees. The emit-helper → event-type map is read from BaseChannelPlugin
 * itself, so new helpers are picked up without touching this test.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChannelPlugin } from '../types/plugin';

const packagesRoot = resolve(import.meta.dir, '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

const baseSource = readFileSync(join(packagesRoot, 'channel-sdk/src/base/BaseChannelPlugin.ts'), 'utf8');
const helperTypes = new Map(
  [...baseSource.matchAll(/protected async (emit\w+)\([\s\S]*?'([a-z_]+\.[a-z_.]+)'/g)].map((m) => [m[1], m[2]]),
);

function scanPackage(pkg: string) {
  const code = sources(join(packagesRoot, pkg, 'src')).join('\n');
  const emitted = new Set<string>();
  for (const [helper, type] of helperTypes) if (new RegExp(`\\b${helper}\\(`).test(code)) emitted.add(type);
  for (const m of code.matchAll(/(?:\.publish\(\s*|type: )'([a-z_]+\.[a-z_.]+)'/g)) emitted.add(m[1] as string);
  for (const m of code.matchAll(/type: '([a-z_]+\.[a-z_.]+)' \| '([a-z_]+\.[a-z_.]+)'/g)) emitted.add(m[2] as string);
  return {
    emitted: [...emitted].filter((t) => !t.startsWith('custom.')).sort(),
    edits: /type: 'edit'/.test(code),
    deletes: /type: 'delete'/.test(code),
    rawMessagePublish: /\.publish\(\s*'(message|reaction)\./.test(code),
  };
}

const channelPackages = readdirSync(packagesRoot).filter((p) => p.startsWith('channel-') && p !== 'channel-sdk');

describe('channel event capabilities match published events', () => {
  it('derives emit helpers from BaseChannelPlugin', () => {
    expect(helperTypes.get('emitMessageReceived')).toBe('message.received');
    expect(helperTypes.get('emitReactionReceived')).toBe('reaction.received');
  });

  for (const pkg of channelPackages) {
    it(pkg, async () => {
      const plugin = (await import(join(packagesRoot, pkg, 'src/index.ts'))).default as ChannelPlugin;
      const declared = plugin.capabilities.events;
      expect(declared).toBeDefined();
      const scan = scanPackage(pkg);
      expect([...(declared?.emits ?? [])].sort()).toEqual(scan.emitted);
      if (scan.edits) expect(declared?.edits).toBe(true);
      if (scan.deletes) expect(declared?.deletes).toBe(true);
      // A raw publish bypasses the claimed-ingress key helpers.
      if (scan.rawMessagePublish) expect(declared?.idempotency).not.toBe(true);
    });
  }
});
