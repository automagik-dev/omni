import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESKTOP_TAG_PREFIX,
  type DesktopRelease,
  PRELOAD,
  appCacheDir,
  createDesktopCommand,
  desktopHome,
  desktopTarget,
  extractionDir,
  launchPlan,
  parseSums,
  pickRelease,
  sha256Of,
  writePreload,
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

  test('macOS takes the dmg for its own architecture, from a signed release only', () => {
    const arm = desktopTarget('darwin', 'arm64');
    if (!arm.supported) throw new Error('unreachable');
    expect(arm.asset.test('Omni-0.1.0-labs.1-mac-arm64.dmg')).toBe(true);
    expect(arm.asset.test('Omni-0.1.0-labs.1-mac-x64.dmg')).toBe(false);
    expect(arm.requires).toBe('latest-mac.yml');
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
  test("the newest that has this machine's build and its checksums; on macOS a signed one", () => {
    const linux = desktopTarget('linux', 'x64', '');
    const mac = desktopTarget('darwin', 'arm64');
    if (!linux.supported || !mac.supported) throw new Error('unreachable');
    const automagik = [
      // A release with the plugins only, then one whose macOS build is unsigned (no feed).
      release('v3.261024.2', ['automagik-bots-dsh-3.261024.2.tgz', 'plugins.json']),
      release('v3.261024.1', [
        'Omni-3.261024.1-linux-x86_64.AppImage',
        'Omni-3.261024.1-mac-arm64.dmg',
        'latest-linux.yml',
        'SHA256SUMS',
      ]),
      release('v3.261023.1', ['Omni-3.261023.1-linux-x86_64.AppImage']),
    ];
    expect(pickRelease(automagik, undefined, linux)?.tag_name).toBe('v3.261024.1');
    expect(pickRelease(automagik, undefined, mac)).toBeUndefined();
    const signed = release('v3.261025.1', ['Omni-3.261025.1-mac-arm64.dmg', 'latest-mac.yml', 'SHA256SUMS']);
    expect(pickRelease([signed, ...automagik], undefined, mac)?.tag_name).toBe('v3.261025.1');
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
      args: ['--preload=omni'],
    });
    expect(launchPlan('/a/Omni.dmg', mac, '/unused')).toEqual({ command: 'open', args: ['/a/Omni.dmg'] });
  });
});

test("the preload lands in the app's home, where the app reads it however it was installed", () => {
  const omniHome = mkdtempSync(join(tmpdir(), 'omni-desktop-preload-'));
  expect(PRELOAD).toBe('omni');
  expect(desktopHome({ OMNI_HOME: omniHome })).toBe(join(omniHome, 'desktop'));
  expect(desktopHome({ OMNI_HOME: omniHome, OMNI_DESKTOP_HOME: '/srv/app' })).toBe('/srv/app');
  const file = writePreload({ OMNI_HOME: omniHome });
  expect(file).toBe(join(omniHome, 'desktop', 'preload'));
  expect(readFileSync(file, 'utf8')).toBe('omni\n');
});

test('the command is `desktop`, with --path, --tag and --dry-run', () => {
  const command = createDesktopCommand();
  expect(command.name()).toBe('desktop');
  expect(command.options.map((option) => option.long)).toEqual(['--path', '--tag', '--dry-run']);
});
