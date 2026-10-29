/**
 * Loading @anthropic-ai/claude-agent-sdk, which only the claude-code provider needs.
 *
 * The published CLI keeps the SDK out of its bundle and lists it as an optional dependency, so it
 * can be absent at run time. "Absent" here is a real one: a module in a fresh temp dir, with no
 * node_modules above it, that re-exports the SDK, so the error is the one Bun raises.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClaudeAgentSdk } from '../claude-code-client';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omni-agent-sdk-absent-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** An importer for which the SDK is not installed. */
function absentSdk() {
  const probe = join(dir, 'probe.mjs');
  writeFileSync(probe, "export * from '@anthropic-ai/claude-agent-sdk';\n");
  return () => import(pathToFileURL(probe).href);
}

describe('loadClaudeAgentSdk', () => {
  it('names the claude-code provider and how to install the SDK when it is absent', async () => {
    const error = await loadClaudeAgentSdk(absentSdk()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('claude-code provider');
    expect(message).toContain('@anthropic-ai/claude-agent-sdk');
    expect(message).toContain('--omit=optional');
  });

  it('passes any other load error through unchanged', async () => {
    const broken = new Error('SyntaxError in sdk.mjs');
    await expect(loadClaudeAgentSdk(() => Promise.reject(broken))).rejects.toBe(broken);
  });

  it('loads the installed SDK', async () => {
    const sdk = await loadClaudeAgentSdk();
    expect(typeof sdk.query).toBe('function');
  });
});
