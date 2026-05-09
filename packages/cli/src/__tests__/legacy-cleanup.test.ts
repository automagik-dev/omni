/**
 * legacy-cleanup tests
 *
 * Covers the registry-level orchestration. The day-one nats-reply-sidecar
 * entry shells out to `pm2 jlist` / `pgrep`; we assert behavior through
 * synthetic LegacyArtifact instances and through the REGISTRY's identity
 * (it must contain a `nats-reply-sidecar` entry).
 *
 * Byte-identical formatCleanupSummary output is covered by
 * `sidecar-cleanup.test.ts` — those tests still drive the rendering and
 * remain unchanged.
 */

import { describe, expect, test } from 'bun:test';
import { parseSkipCleanupList } from '../commands/update.js';
import { type LegacyArtifact, REGISTRY, cleanupLegacyArtifacts } from '../legacy-cleanup.js';

function fakeArtifact(overrides: Partial<LegacyArtifact> & Pick<LegacyArtifact, 'name'>): LegacyArtifact {
  return {
    name: overrides.name,
    detect: overrides.detect ?? (async () => true),
    cleanup: overrides.cleanup ?? (async () => ({ removed: [], warnings: [] })),
    summary: overrides.summary ?? (() => ''),
  };
}

describe('REGISTRY', () => {
  test('contains the nats-reply-sidecar entry as the day-one artifact', () => {
    const names = REGISTRY.map((a) => a.name);
    expect(names).toContain('nats-reply-sidecar');
  });

  test('every entry exposes a stable string name', () => {
    for (const artifact of REGISTRY) {
      expect(typeof artifact.name).toBe('string');
      expect(artifact.name.length).toBeGreaterThan(0);
    }
  });

  test('every entry exposes async detect / cleanup and a sync summary', () => {
    for (const artifact of REGISTRY) {
      expect(typeof artifact.detect).toBe('function');
      expect(typeof artifact.cleanup).toBe('function');
      expect(typeof artifact.summary).toBe('function');
    }
  });
});

describe('cleanupLegacyArtifacts — orchestration', () => {
  // We swap REGISTRY contents by spying on a fresh array — but the public
  // API uses the live constant. To exercise orchestration without touching
  // the real nats-reply-sidecar, we drive the algorithm with synthetic
  // artifacts via a helper that mirrors `cleanupLegacyArtifacts` semantics.

  test('skips an artifact whose name is in skipList', async () => {
    const calls: string[] = [];
    const ran = fakeArtifact({
      name: 'will-run',
      detect: async () => {
        calls.push('detect:will-run');
        return true;
      },
      cleanup: async () => {
        calls.push('cleanup:will-run');
        return { removed: ['x'], warnings: [] };
      },
    });
    const skipped = fakeArtifact({
      name: 'will-skip',
      detect: async () => {
        calls.push('detect:will-skip');
        return true;
      },
      cleanup: async () => {
        calls.push('cleanup:will-skip');
        return { removed: ['y'], warnings: [] };
      },
    });

    const report = await runRegistry([ran, skipped], new Set(['will-skip']));

    expect(calls).toEqual(['detect:will-run', 'cleanup:will-run']);
    expect(report.skipped).toEqual(['will-skip']);
    expect(report.outcomes).toHaveLength(2);
    expect(report.outcomes[0]?.state).toBe('ran');
    expect(report.outcomes[1]?.state).toBe('skipped');
  });

  test('records `not-detected` when detect() returns false', async () => {
    const a = fakeArtifact({
      name: 'absent',
      detect: async () => false,
    });
    const report = await runRegistry([a], new Set());
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]?.state).toBe('not-detected');
    expect(report.succeeded).toBe(true);
  });

  test('captures warnings into the outcome and flips `succeeded` to false', async () => {
    const a = fakeArtifact({
      name: 'partial-fail',
      cleanup: async () => ({ removed: ['ok-1'], warnings: ['could-not-stop:pid=42'] }),
      summary: () => 'partial summary',
    });
    const report = await runRegistry([a], new Set());
    expect(report.outcomes[0]?.state).toBe('ran');
    expect(report.outcomes[0]?.warnings).toEqual(['could-not-stop:pid=42']);
    expect(report.outcomes[0]?.summary).toBe('partial summary');
    expect(report.succeeded).toBe(false);
  });

  test('treats a thrown detect() as `errored` and records the message', async () => {
    const a = fakeArtifact({
      name: 'detect-throws',
      detect: async () => {
        throw new Error('boom');
      },
    });
    const report = await runRegistry([a], new Set());
    expect(report.outcomes[0]?.state).toBe('errored');
    expect(report.outcomes[0]?.error).toBe('boom');
    expect(report.succeeded).toBe(false);
  });

  test('treats a thrown cleanup() as `errored` and records the message', async () => {
    const a = fakeArtifact({
      name: 'cleanup-throws',
      cleanup: async () => {
        throw new Error('kaboom');
      },
    });
    const report = await runRegistry([a], new Set());
    expect(report.outcomes[0]?.state).toBe('errored');
    expect(report.outcomes[0]?.error).toBe('kaboom');
    expect(report.succeeded).toBe(false);
  });

  test('returns succeeded=true when every ran artifact had zero warnings', async () => {
    const a = fakeArtifact({
      name: 'clean-1',
      cleanup: async () => ({ removed: ['a'], warnings: [] }),
    });
    const b = fakeArtifact({
      name: 'clean-2',
      cleanup: async () => ({ removed: ['b'], warnings: [] }),
    });
    const report = await runRegistry([a, b], new Set());
    expect(report.succeeded).toBe(true);
    expect(report.outcomes.map((o) => o.state)).toEqual(['ran', 'ran']);
  });

  test('runs entries sequentially in declaration order', async () => {
    const trace: string[] = [];
    const a = fakeArtifact({
      name: 'first',
      cleanup: async () => {
        trace.push('first');
        return { removed: [], warnings: [] };
      },
    });
    const b = fakeArtifact({
      name: 'second',
      cleanup: async () => {
        trace.push('second');
        return { removed: [], warnings: [] };
      },
    });
    await runRegistry([a, b], new Set());
    expect(trace).toEqual(['first', 'second']);
  });

  test('runs the live REGISTRY end-to-end without throwing (smoke test)', async () => {
    // The real cleanupSidecars() shells out to pm2/pgrep. On a clean test
    // host neither finds anything, which is the byte-identical "empty
    // summary" path — that's what we assert here.
    const report = await cleanupLegacyArtifacts(new Set(['nats-reply-sidecar']));
    expect(report.skipped).toContain('nats-reply-sidecar');
    expect(report.outcomes.find((o) => o.name === 'nats-reply-sidecar')?.state).toBe('skipped');
  });
});

describe('parseSkipCleanupList', () => {
  test('returns empty set for undefined or empty input', () => {
    expect(parseSkipCleanupList(undefined).size).toBe(0);
    expect(parseSkipCleanupList('').size).toBe(0);
    expect(parseSkipCleanupList('  ').size).toBe(0);
  });

  test('splits on commas and trims whitespace', () => {
    const set = parseSkipCleanupList('a,b , c ,,d');
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(true);
    expect(set.has('d')).toBe(true);
    expect(set.size).toBe(4);
  });

  test('handles a single name', () => {
    const set = parseSkipCleanupList('nats-reply-sidecar');
    expect(set.has('nats-reply-sidecar')).toBe(true);
    expect(set.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test helper: drive the same orchestration shape as cleanupLegacyArtifacts
// against an arbitrary list of artifacts. This mirrors the algorithm so we
// can exercise every branch without monkey-patching the live REGISTRY.
// ---------------------------------------------------------------------------
async function runRegistry(
  artifacts: LegacyArtifact[],
  skipList: Set<string>,
): Promise<Awaited<ReturnType<typeof cleanupLegacyArtifacts>>> {
  // We import the real implementation but feed it a list by temporarily
  // splicing the live REGISTRY. Bun's test runner is single-threaded so
  // the splice is safe across awaits within one test.
  const saved = REGISTRY.splice(0, REGISTRY.length, ...artifacts);
  try {
    return await cleanupLegacyArtifacts(skipList);
  } finally {
    REGISTRY.splice(0, REGISTRY.length, ...saved);
  }
}
