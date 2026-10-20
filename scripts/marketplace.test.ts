import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_PATH, REPO_URL, checkIndex } from './marketplace';

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

  test("a git source from another repository fails, and DSH's own parser runs first", () => {
    const foreign = { source: { type: 'git', url: 'https://github.com/someone/else', commit: head } };
    expect(checkIndex(indexWith(foreign), repoDir)[0]).toContain('must come from');
    expect(checkIndex({ format: 2 }, repoDir)[0]).toContain('$.format');
  });
});
