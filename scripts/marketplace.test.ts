import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseCommit } from './lib/plugin-versions';
import { AUTOMAGIK_URL, INDEX_PATH, REPO_URL, checkIndex, pinAutomagik, pinIndex } from './marketplace';

const repoDir = join(import.meta.dir, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
const channels = JSON.parse(readFileSync(join(repoDir, 'apps/omni-channels-dsh/package.json'), 'utf8'));

function indexWith(entry: Record<string, unknown>, name = channels.name) {
  return {
    format: 1,
    title: { en: 'Test' },
    plugins: [{ name, versions: [{ version: channels.version, publishTimestamp: 1, ...entry }] }],
  };
}
// An entry of ours lists the DSH range its package.json declares.
const ours = (commit: string, path = 'apps/omni-channels-dsh') => ({
  source: { type: 'git', url: REPO_URL, commit, path },
  engines: { dsh: channels.engines.dsh },
});
const readJson = (path: string) => JSON.parse(readFileSync(join(repoDir, path), 'utf8'));

describe('marketplace index check', () => {
  test("Omni's own plugins are listed at their version in the pinned candidate", () => {
    // pin-candidate.yml writes .well-known/latest.json and runs `marketplace.ts pin v<version>` in the
    // same commit, so the index never trails the Omni release it ships with. Each plugin carries the
    // Omni release of its last change, so its newest entry is the version its package.json has in
    // the candidate, pinned to a commit no newer than the candidate's that holds that version.
    const candidate = readJson('.well-known/latest.json').version;
    const at = (commit: string, path: string) =>
      JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { cwd: repoDir, encoding: 'utf8' }));
    // The candidate's tag is fetched when this clone lacks it (CI checks out without tags).
    const tag = releaseCommit(repoDir, candidate);
    if (!tag) throw new Error(`no release v${candidate}`);
    const index = readJson('marketplace/automagik.json');
    const own = index.plugins.filter(
      (plugin: { versions: { source: { url?: string } }[] }) => plugin.versions[0]?.source.url === REPO_URL,
    );
    expect(own.map((plugin: { name: string }) => plugin.name).sort()).toEqual(
      ['omni-channels-dsh', 'omni-canvas-dsh'].map((dir) => readJson(`apps/${dir}/package.json`).name).sort(),
    );
    for (const plugin of own) {
      const [newest] = plugin.versions;
      const version = at(tag, `${newest.source.path}/package.json`).version;
      expect([plugin.name, newest.version]).toEqual([plugin.name, version]);
      expect(Bun.semver.order(version, candidate)).toBeLessThanOrEqual(0);
      expect(
        execFileSync('git', ['merge-base', '--is-ancestor', newest.source.commit, tag], { cwd: repoDir }).length,
      ).toBe(0);
    }
  });

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
    expect(checkIndex(indexWith(ours(head, 'apps/nowhere'), channels.name), repoDir)[0]).toContain('has no');
  });

  test("an outside plugin fails, from git or npm, and DSH's own parser runs first", () => {
    const foreign = {
      source: { type: 'git', url: 'https://github.com/automagik-genie/dsh-oh-my-claude', commit: head },
    };
    expect(checkIndex(indexWith(foreign), repoDir)[0]).toContain('must be git commits of');
    expect(checkIndex(indexWith({ source: { type: 'npm' } }), repoDir)[0]).toContain('must be git commits of');
    expect(checkIndex({ format: 2 }, repoDir)[0]).toContain('$.format');
  });

  test("Automagik's plugins are listed at the release apps/automagik.json pins, and nowhere else", () => {
    const pin = JSON.parse(readFileSync(join(repoDir, 'apps/automagik.json'), 'utf8'));
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    for (const name of Object.keys(pin.packages)) {
      const listed = index.plugins.find((plugin: { name: string }) => plugin.name === name);
      expect(listed?.versions).toHaveLength(1);
      expect(listed.versions[0]).toMatchObject({
        version: pin.version,
        source: {
          type: 'git',
          url: AUTOMAGIK_URL,
          commit: pin.commit,
          path: `apps/${name.slice('@automagik/'.length)}`,
        },
      });
    }
    // The names they had in this repository are not listed any more.
    for (const old of ['@automagik/omni-dsh', '@automagik/omni-ai-dsh'])
      expect(index.plugins.some((plugin: { name: string }) => plugin.name === old)).toBe(false);
    const reads: string[] = [];
    const readAutomagik = (url: string, at: string, path: string) => {
      reads.push(`${url} ${at} ${path}`);
      return { name: '@automagik/bots-dsh', version: pin.version };
    };
    const team = (version: string, commit: string) => ({
      format: 1,
      title: { en: 'Test' },
      plugins: [
        {
          name: '@automagik/bots-dsh',
          versions: [
            {
              version,
              publishTimestamp: 1,
              source: { type: 'git', url: AUTOMAGIK_URL, commit, path: 'apps/bots-dsh' },
            },
          ],
        },
      ],
    });
    expect(checkIndex(team(pin.version, pin.commit), repoDir, readAutomagik, pin)).toEqual([]);
    expect(reads).toEqual([`${AUTOMAGIK_URL} ${pin.commit} apps/bots-dsh`]);
    expect(checkIndex(team(pin.version, 'd'.repeat(40)), repoDir, readAutomagik, pin)[0]).toContain(
      'apps/automagik.json pins',
    );
    expect(checkIndex(team('3.0.0', pin.commit), repoDir, readAutomagik, pin)[0]).toContain('apps/automagik.json pins');
    // pinAutomagik moves them to a new pin, one version each.
    const next = {
      ...pin,
      version: '3.261231.9',
      commit: 'e'.repeat(40),
      packages: { '@automagik/bots-dsh': { version: '3.261231.9' } },
    };
    const moved = pinAutomagik(team(pin.version, pin.commit) as never, next, 42, () => null);
    expect(moved.plugins[0]?.versions).toEqual([
      {
        version: '3.261231.9',
        publishTimestamp: 42,
        source: { type: 'git', url: AUTOMAGIK_URL, commit: 'e'.repeat(40), path: 'apps/bots-dsh' },
      },
    ]);
    // ...listing the DSH range their package.json declares at the pinned commit.
    const ranged = pinAutomagik(team(pin.version, pin.commit) as never, next, 42, () => ({
      name: '@automagik/bots-dsh',
      version: '3.261231.9',
      engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' },
    }));
    expect(ranged.plugins[0]?.versions[0]?.engines).toEqual({ dsh: '>=0.2.1-rc.3 <0.2.2-0' });
  });

  test('an entry lists the DSH range its package.json declares, which covers the DSH its tests run on', () => {
    const range = channels.engines.dsh;
    expect(checkIndex(indexWith(ours(head)), repoDir)).toEqual([]);
    expect(checkIndex(indexWith({ ...ours(head), engines: { dsh: '>=0.2.1-rc.2 <0.3.0' } }), repoDir)[0]).toContain(
      `lists dsh >=0.2.1-rc.2 <0.3.0 but its package.json declares ${range}`,
    );
    const { engines: _, ...unranged } = ours(head);
    expect(checkIndex(indexWith(unranged), repoDir)[0]).toContain('lists dsh (none)');
    const readAutomagik = () => ({ name: '@automagik/bots-dsh', version: '3.1.0', engines: { dsh: range } });
    const team = {
      format: 1,
      title: { en: 'Test' },
      plugins: [
        {
          name: '@automagik/bots-dsh',
          versions: [
            {
              version: '3.1.0',
              publishTimestamp: 1,
              source: { type: 'git', url: AUTOMAGIK_URL, commit: 'f'.repeat(40), path: 'apps/bots-dsh' },
            },
          ],
        },
      ],
    };
    const pin = { version: '3.1.0', commit: 'f'.repeat(40), packages: { '@automagik/bots-dsh': { version: '3.1.0' } } };
    expect(checkIndex(team, repoDir, readAutomagik, pin)[0]).toContain('lists dsh (none)');
    // Each plugin of ours declares a tested range, and the DSH its tests run on is in it.
    for (const dir of ['omni-channels-dsh', 'omni-canvas-dsh']) {
      const declared = readJson(`apps/${dir}/package.json`).engines?.dsh;
      const tested = readJson(`apps/${dir}/dev/harness/package.json`).dependencies['@deepseek-ai/dsh'];
      expect(typeof declared).toBe('string');
      expect(Bun.semver.satisfies(tested, declared)).toBe(true);
    }
  });

  test('pin lists a new version with the DSH range its package.json declares at the ref', () => {
    const older = {
      plugins: [
        {
          name: channels.name,
          versions: [
            {
              version: '2.261025.1',
              publishTimestamp: 1,
              source: { type: 'git' as const, url: REPO_URL, commit: head, path: 'apps/omni-channels-dsh' },
              engines: { dsh: '>=0.0.1' },
            },
          ],
        },
      ],
    };
    const [added] = pinIndex(older, repoDir, 'HEAD').plugins[0]?.versions ?? [];
    expect(added).toMatchObject({ version: channels.version, engines: { dsh: channels.engines.dsh } });
  });

  test('pin keeps a listed version where it is when its package is unchanged, and refuses a changed one', () => {
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
    // omni-ai-dsh 0.1.0 is byte-identical at both commits: its entry stays at its commit and time.
    const kept = pinIndex(listed('@automagik/omni-ai-dsh', '0.1.0', 'apps/omni-ai-dsh'), repoDir, '58a5dee46');
    expect(kept.plugins[0]?.versions).toEqual(
      listed('@automagik/omni-ai-dsh', '0.1.0', 'apps/omni-ai-dsh').plugins[0]?.versions,
    );
  });

  test('pin adds a moved plugin at its new version and keeps an unchanged one, older versions included', () => {
    // At v2.261025.2 both plugins are 2.261025.2; the index lists them there, and earlier ones too.
    const committed = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const ownPlugins = (index: typeof committed) =>
      index.plugins.filter(
        (plugin: { versions: { source: { url?: string } }[] }) => plugin.versions[0]?.source.url === REPO_URL,
      );
    // Later cuts may already sit on top of the committed index, so the test works on the index as it
    // stood at v2.261025.2: every entry newer than that release is dropped first.
    const atRef = structuredClone(committed);
    for (const plugin of ownPlugins(atRef)) {
      plugin.versions = plugin.versions.filter(
        (entry: { version: string }) => Bun.semver.order(entry.version, '2.261025.2') <= 0,
      );
    }
    const before = structuredClone(ownPlugins(atRef));
    const again = pinIndex(structuredClone(atRef), repoDir, 'v2.261025.2');
    expect(ownPlugins(again)).toEqual(before);
    // A plugin whose newest entry is older than its version at the ref gets that version added on top.
    const behind = structuredClone(atRef);
    for (const plugin of ownPlugins(behind)) plugin.versions = plugin.versions.slice(1);
    const added = pinIndex(behind, repoDir, 'v2.261025.2');
    for (const plugin of ownPlugins(added)) {
      expect(plugin.versions[0]).toMatchObject({ version: '2.261025.2' });
      expect(plugin.versions.length).toBe(before.find((p: { name: string }) => p.name === plugin.name).versions.length);
    }
  });
});
