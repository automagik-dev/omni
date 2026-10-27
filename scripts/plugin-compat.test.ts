/**
 * Omni's own DSH plugins declare what they need, and work with it: the oldest Omni
 * (`engines.omni`, checked against that release's API by scripts/plugin-compat.ts) and the Bot
 * team (`peerDependencies['@automagik/bots-dsh']`, a range the pinned Automagik release meets).
 *
 * Run: bun test scripts/plugin-compat.test.ts (needs the release tags; it fetches the ones it reads)
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimumOf, ownPlugins, releaseCommit } from './lib/plugin-versions';
import { apiSurface, checkPlugin, pluginUses, serves } from './plugin-compat';

const root = join(import.meta.dir, '..');
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const repoVersion: string = readJson('package.json').version;
const plugins = ownPlugins(root);
const here = apiSurface(null);

describe("Omni's plugins and the Omni they need", () => {
  test('both plugins declare engines.omni as a minimum Omni release', () => {
    expect(plugins.map((plugin) => plugin.dir)).toEqual(['apps/omni-canvas-dsh', 'apps/omni-channels-dsh']);
    for (const plugin of plugins)
      expect({ dir: plugin.dir, minimum: minimumOf(plugin.omniRange) }).toEqual({
        dir: plugin.dir,
        minimum: expect.stringMatching(/^\d+\.\d{6}\.\d+$/),
      });
  });

  test('every Omni API path a plugin names is served by its minimum release', () => {
    for (const plugin of plugins) {
      const result = checkPlugin(plugin.dir, plugin.omniRange, repoVersion, root);
      expect({ dir: plugin.dir, problems: result.problems }).toEqual({ dir: plugin.dir, problems: [] });
    }
  }, 60_000);

  test('the scan sees the calls the channels plugin makes, with their methods', () => {
    const uses = pluginUses(join(root, 'apps/omni-channels-dsh'), here).map((use) => `${use.method} ${use.path}`);
    expect(uses).toContain('POST /api/v2/messages/send');
    expect(uses).toContain('GET /api/v2/instances/{}/status');
    expect(uses).toContain('POST /api/v2/login/connect');
    expect(uses).toContain('POST /api/auth/device/token');
    // The generated catalogue of every route is not a use.
    expect(uses.some((use) => use.includes('/batch-jobs'))).toBe(false);
  });

  test('a minimum older than an API the plugin uses fails, naming the API', () => {
    // POST /api/v2/login/connect (connect links) arrived in 2.261023.15; the chat-key routes
    // the threads' keys use (thread-keys.js), later still.
    const result = checkPlugin('apps/omni-channels-dsh', '>=2.261023.14', repoVersion, root);
    expect(result.against).toBe('v2.261023.14');
    expect(result.problems).toEqual([
      'Omni 2.261023.14 serves no POST /api/v2/keys/children (src/host/thread-keys.js): raise engines.omni',
      'Omni 2.261023.14 serves no POST /api/v2/keys/children/{}/revoke (src/host/thread-keys.js): raise engines.omni',
      'Omni 2.261023.14 serves no POST /api/v2/keys/children/self/revoke (src/host/thread-keys.js): raise engines.omni',
      'Omni 2.261023.14 serves no POST /api/v2/login/connect (src/host/omni-link.js): raise engines.omni',
    ]);
  }, 60_000);

  test('a planted call to an API newer than the minimum fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-compat-'));
    try {
      mkdirSync(join(dir, 'src', 'host'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'host', 'planted.js'),
        "export const link = (call, grant) => call('POST', '/login/connect', { grant })\n" +
          "export const chats = (call, id) => call('GET', `/chats/${encodeURIComponent(id)}/messages?limit=5`)\n",
      );
      const uses = pluginUses(dir, here);
      expect(uses.map((use) => `${use.method} ${use.path}`)).toEqual([
        'GET /api/v2/chats/{}/messages',
        'POST /api/v2/login/connect',
      ]);
      const commit = releaseCommit(root, '2.261023.14');
      expect(commit).not.toBeNull();
      const then = apiSurface(commit);
      expect(uses.filter((use) => !serves(then, use)).map((use) => use.path)).toEqual(['/api/v2/login/connect']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('a path this Omni does not serve fails as unseen, never passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-compat-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'x.js'), "export const x = call => call('POST', '/chats/{id}/teleport')\n");
      const [use] = pluginUses(dir, here);
      expect(use).toMatchObject({ method: 'POST', path: '/api/v2/chats/{}/teleport' });
      expect(serves(here, use as NonNullable<typeof use>)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a pending minimum (above the repository) is checked against this tree', () => {
    const result = checkPlugin('apps/omni-channels-dsh', '>=9.999999.1', repoVersion, root);
    expect(result.against).toBe('this tree (pending)');
    expect(result.problems).toEqual([]);
  });

  test('a minimum that is no release fails', () => {
    expect(checkPlugin('apps/omni-channels-dsh', '>=2.261023.999', repoVersion, root).problems).toContain(
      'there is no Omni release 2.261023.999 (tag v2.261023.999)',
    );
    expect(checkPlugin('apps/omni-channels-dsh', '^2.261023.1', repoVersion, root).problems).toContain(
      'engines.omni "^2.261023.1" is not ">=<Omni release>"',
    );
  });
});

describe("Omni's plugins and the Bot team", () => {
  const pin = readJson('apps/automagik.json');

  test('declare a real range of the Bot team, which the pinned Automagik release meets', () => {
    const tested: string = pin.packages['@automagik/bots-dsh'].version;
    for (const plugin of plugins) {
      const range: string = readJson(`${plugin.dir}/package.json`).peerDependencies['@automagik/bots-dsh'];
      expect({ dir: plugin.dir, tested, meets: Bun.semver.satisfies(tested, range) }).toEqual({
        dir: plugin.dir,
        tested,
        meets: true,
      });
      // Automagik numbered 3.<yymmdd>.<n> before 3.N; those builds are older than 3.2.0 though
      // SemVer ranks them higher, and these plugins were never tested on them.
      expect(Bun.semver.satisfies('3.261024.1', range)).toBe(false);
      expect(Bun.semver.satisfies('4.0.0', range)).toBe(false);
    }
  });

  test("the canvases' range of the channels plugin admits the channels plugin they are tested with", () => {
    const channels: string = readJson('apps/omni-channels-dsh/package.json').version;
    const range: string = readJson('apps/omni-canvas-dsh/package.json').peerDependencies[
      '@automagik/omni-channels-dsh'
    ];
    expect(Bun.semver.satisfies(channels, range)).toBe(true);
  });
});
