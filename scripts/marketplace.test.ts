import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_PATH, REPO_URL, VETTED_FORKS, checkIndex, pinIndex } from './marketplace';

const repoDir = join(import.meta.dir, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
const omniUi = JSON.parse(readFileSync(join(repoDir, 'apps/omni-ui-dsh/package.json'), 'utf8'));

function indexWith(entry: Record<string, unknown>, name = omniUi.name) {
  return {
    format: 1,
    title: { en: 'Test' },
    plugins: [{ name, versions: [{ version: omniUi.version, publishTimestamp: 1, ...entry }] }],
  };
}
const ours = (commit: string, path = 'apps/omni-ui-dsh') => ({ source: { type: 'git', url: REPO_URL, commit, path } });

describe('marketplace index check', () => {
  test('the committed index passes', () => {
    expect(checkIndex(JSON.parse(readFileSync(INDEX_PATH, 'utf8')), repoDir)).toEqual([]);
  });

  test('an entry pinned to HEAD with the package there passes', () => {
    expect(checkIndex(indexWith(ours(head)), repoDir)).toEqual([]);
  });

  test('a commit that is not in the history fails', () => {
    const [problem] = checkIndex(indexWith(ours('0'.repeat(40))), repoDir);
    expect(problem).toContain('not reachable from HEAD');
  });

  test('a commit whose package is another name or version fails', () => {
    expect(checkIndex(indexWith(ours(head), '@automagik/not-omni'), repoDir)[0]).toContain('package.json is');
    expect(checkIndex(indexWith(ours(head, 'apps/nowhere'), omniUi.name), repoDir)[0]).toContain('has no');
  });

  test("a vetted fork's commit passes only when its package.json is the entry's name and version", () => {
    const fork = VETTED_FORKS[0] as string;
    const commit = 'c'.repeat(40);
    const entry = { source: { type: 'git', url: fork, commit } };
    const reads: string[] = [];
    const readFork = (url: string, at: string, path: string) => {
      reads.push(`${url} ${at} ${path}`);
      return { name: 'dsh-oh-my-claude', version: '1.5.6-omni.1' };
    };
    const index = (version: string) => ({
      format: 1,
      title: { en: 'Test' },
      plugins: [{ name: 'dsh-oh-my-claude', versions: [{ version, publishTimestamp: 1, ...entry }] }],
    });
    expect(checkIndex(index('1.5.6-omni.1'), repoDir, readFork)).toEqual([]);
    expect(reads).toEqual([`${fork} ${commit} .`]);
    expect(checkIndex(index('1.5.7'), repoDir, readFork)[0]).toContain('is dsh-oh-my-claude@1.5.6-omni.1');
    expect(checkIndex(index('1.5.6-omni.1'), repoDir, () => null)[0]).toContain('has no ./package.json');
  });

  test("a git source from another repository fails, and DSH's own parser runs first", () => {
    const foreign = { source: { type: 'git', url: 'https://github.com/someone/else', commit: head } };
    expect(checkIndex(indexWith(foreign), repoDir)[0]).toContain('must come from');
    expect(checkIndex({ format: 2 }, repoDir)[0]).toContain('$.format');
  });

  test('pin re-points a listed version only when its package is unchanged', () => {
    // apps/omni-ui-dsh was 0.1.7 at both commits, with the Connect Omni step added in between.
    const listed = (name: string, version: string, path: string) => ({
      plugins: [
        {
          name,
          versions: [
            {
              version,
              publishTimestamp: 1,
              source: { type: 'git' as const, url: REPO_URL, commit: 'b1ed5c4ee6b5df3cec0a191e5527c1b50fa08de1', path },
            },
          ],
        },
      ],
    });
    expect(() => pinIndex(listed('@automagik/omni-dsh', '0.1.7', 'apps/omni-ui-dsh'), repoDir, '54ddd408a')).toThrow(
      /bump its version/,
    );
    // omni-ai-dsh 0.1.0 is byte-identical at both commits, so it may move.
    const moved = pinIndex(listed('@automagik/omni-ai-dsh', '0.1.0', 'apps/omni-ai-dsh'), repoDir, '58a5dee46');
    expect(moved.plugins[0]?.versions[0]?.source).toMatchObject({ commit: '58a5dee464713bef73e2e2b754e85c5425bfa660' });
  });
});
