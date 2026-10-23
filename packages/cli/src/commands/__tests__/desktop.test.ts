import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  DESKTOP_TAG_PREFIX,
  type DesktopRelease,
  appCacheDir,
  createDesktopCommand,
  desktopTarget,
  extractionDir,
  launchPlan,
  parseSums,
  pickRelease,
  sha256Of,
} from '../desktop';

const release = (tag: string, names: string[], extra: Partial<DesktopRelease> = {}): DesktopRelease => ({
  tag_name: tag,
  draft: false,
  prerelease: true,
  assets: names.map((name) => ({ name, browser_download_url: `https://example.com/${tag}/${name}`, size: 1 })),
  ...extra,
});

describe('desktopTarget', () => {
  test('Linux x64 takes the AppImage, and WSL is told apart by /proc/version', () => {
    const linux = desktopTarget('linux', 'x64', 'Linux version 6.8.0-49-generic (buildd@lcy02)');
    expect(linux).toMatchObject({ supported: true, os: 'linux', wsl: false });
    if (!linux.supported) throw new Error('unreachable');
    expect(linux.asset.test('Omni-0.1.0-labs.1-linux-x86_64.AppImage')).toBe(true);
    expect(linux.asset.test('Omni-0.1.0-labs.1-linux-amd64.deb')).toBe(false);
    expect(desktopTarget('linux', 'x64', 'Linux version 5.15.167.4-microsoft-standard-WSL2')).toMatchObject({
      wsl: true,
    });
  });

  test('macOS takes the dmg for its own architecture', () => {
    const arm = desktopTarget('darwin', 'arm64');
    if (!arm.supported) throw new Error('unreachable');
    expect(arm.asset.test('Omni-0.1.0-labs.1-mac-arm64.dmg')).toBe(true);
    expect(arm.asset.test('Omni-0.1.0-labs.1-mac-x64.dmg')).toBe(false);
  });

  test('Windows itself, and builds that do not exist, are refused with a reason', () => {
    const windows = desktopTarget('win32', 'x64');
    expect(windows.supported).toBe(false);
    if (windows.supported) throw new Error('unreachable');
    expect(windows.reason).toContain('WSL');
    expect(desktopTarget('linux', 'arm64').supported).toBe(false);
    expect(desktopTarget('freebsd', 'x64').supported).toBe(false);
  });
});

describe('pickRelease', () => {
  const releases = [
    release('nightly', ['omni-linux-x64.tar.gz']),
    release(`${DESKTOP_TAG_PREFIX}0.2.0`, ['a'], { draft: true }),
    release(`${DESKTOP_TAG_PREFIX}0.1.1`, ['b']),
    release(`${DESKTOP_TAG_PREFIX}0.1.0`, ['c']),
  ];
  test('the newest published desktop release, skipping drafts and other tags', () => {
    expect(pickRelease(releases)?.tag_name).toBe(`${DESKTOP_TAG_PREFIX}0.1.1`);
  });
  test("the one built with the CLI's own version first, when there is one", () => {
    expect(pickRelease(releases, undefined, '0.1.0')?.tag_name).toBe(`${DESKTOP_TAG_PREFIX}0.1.0`);
    expect(pickRelease(releases, undefined, '9.9.9')?.tag_name).toBe(`${DESKTOP_TAG_PREFIX}0.1.1`);
  });
  test('or exactly the one asked for', () => {
    expect(pickRelease(releases, `${DESKTOP_TAG_PREFIX}0.1.0`)?.tag_name).toBe(`${DESKTOP_TAG_PREFIX}0.1.0`);
    expect(pickRelease(releases, `${DESKTOP_TAG_PREFIX}0.2.0`)).toBeUndefined();
    expect(pickRelease([])).toBeUndefined();
  });
});

describe('checksums', () => {
  test('sha256sum output is read per file name', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const sums = parseSums(`${a}  Omni-0.1.0-linux-x86_64.AppImage\n${b} *Omni-0.1.0-mac-arm64.dmg\n\nnot a line\n`);
    expect(sums.get('Omni-0.1.0-linux-x86_64.AppImage')).toBe(a);
    expect(sums.get('Omni-0.1.0-mac-arm64.dmg')).toBe(b.toLowerCase());
    expect(sums.size).toBe(2);
  });
  test('sha256Of matches the known digest of "abc"', () => {
    expect(sha256Of(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('where and how it opens', () => {
  test('builds are kept under OMNI_HOME/desktop/app', () => {
    expect(appCacheDir({ OMNI_HOME: '/srv/omni' })).toBe(join('/srv/omni', 'desktop', 'app'));
  });
  test('an AppImage runs from its one-time unpack in the cache; a dmg is opened', () => {
    const linux = desktopTarget('linux', 'x64', '');
    const mac = desktopTarget('darwin', 'arm64');
    if (!linux.supported || !mac.supported) throw new Error('unreachable');
    const dir = extractionDir('/home/me/Downloads/Omni-0.1.0-linux-x86_64.AppImage', { OMNI_HOME: '/srv/omni' });
    expect(dir).toBe(join('/srv/omni', 'desktop', 'app', 'extracted', 'Omni-0.1.0-linux-x86_64'));
    expect(launchPlan('/x/Omni.AppImage', linux, dir)).toEqual({
      command: join(dir, 'squashfs-root', 'AppRun'),
      args: [],
    });
    expect(launchPlan('/a/Omni.dmg', mac, '/unused')).toEqual({ command: 'open', args: ['/a/Omni.dmg'] });
  });
});

test('the command is `desktop`, with --path, --tag and --dry-run', () => {
  const command = createDesktopCommand();
  expect(command.name()).toBe('desktop');
  expect(command.options.map((option) => option.long)).toEqual(['--path', '--tag', '--dry-run']);
});
