/**
 * Desktop Command
 *
 * omni desktop [--path <file>] [--tag <tag>] [--dry-run]
 *
 * Opens the Omni desktop app (apps/omni-desktop): the Omni UI on a DeepSeek
 * Harness of its own, linked to an Omni by a code sent over WhatsApp. It takes
 * the build for this machine from the repository's GitHub releases (tags
 * `omni-desktop-v*`), checks it against the release's SHA256SUMS, keeps it in
 * ~/.omni/desktop/app/<tag>/, and opens it. `--path` opens a build you already
 * have instead.
 *
 * Linux x64 (and WSL, through WSLg) gets the AppImage; macOS the unsigned labs
 * dmg, which is opened so you can drag Omni to Applications. Windows itself is
 * not supported: run this inside WSL.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import * as output from '../output.js';

const RELEASES_URL = 'https://api.github.com/repos/automagik-dev/omni/releases?per_page=50';
export const DESKTOP_TAG_PREFIX = 'omni-desktop-v';
const SUMS_ASSET = 'SHA256SUMS';

export type DesktopTarget =
  | { supported: true; os: 'linux' | 'mac'; wsl: boolean; asset: RegExp; label: string }
  | { supported: false; reason: string };

/** Which build fits this machine. `procVersion` is /proc/version, which names Microsoft under WSL. */
export function desktopTarget(platform: NodeJS.Platform, arch: string, procVersion = ''): DesktopTarget {
  if (platform === 'linux') {
    if (arch !== 'x64') return { supported: false, reason: `There is no Linux ${arch} build yet; only x64.` };
    const wsl = /microsoft/i.test(procVersion);
    return {
      supported: true,
      os: 'linux',
      wsl,
      asset: /-linux-x86_64\.AppImage$/,
      label: wsl ? 'Linux (WSL)' : 'Linux',
    };
  }
  if (platform === 'darwin') {
    if (arch !== 'arm64' && arch !== 'x64') return { supported: false, reason: `There is no macOS ${arch} build.` };
    return { supported: true, os: 'mac', wsl: false, asset: new RegExp(`-mac-${arch}\\.dmg$`), label: `macOS ${arch}` };
  }
  if (platform === 'win32') {
    return {
      supported: false,
      reason: 'Windows itself is not supported. Run `npx @automagik/omni desktop` inside WSL.',
    };
  }
  return { supported: false, reason: `There is no Omni desktop build for ${platform}.` };
}

const ReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url(), size: z.number() })),
});
export type DesktopRelease = z.infer<typeof ReleaseSchema>;

/** The release to use: the one tagged `tag`, else the newest published desktop release (GitHub lists newest first). */
export function pickRelease(releases: DesktopRelease[], tag?: string): DesktopRelease | undefined {
  const desktop = releases.filter((release) => !release.draft && release.tag_name.startsWith(DESKTOP_TAG_PREFIX));
  return tag ? desktop.find((release) => release.tag_name === tag) : desktop[0];
}

/** `sha256sum` output: "<hex>  <name>" per line. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match?.[1] && match[2]) sums.set(match[2].trim(), match[1].toLowerCase());
  }
  return sums;
}

export const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Where downloaded builds are kept: $OMNI_HOME/desktop/app, else ~/.omni/desktop/app. */
export function appCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const omni = env.OMNI_HOME?.trim() ? resolve(env.OMNI_HOME.trim()) : join(homedir(), '.omni');
  return join(omni, 'desktop', 'app');
}

/** How to open a build: the AppImage itself (extracted to run where FUSE is missing, as under WSL), or `open` for a dmg. */
export function launchPlan(
  file: string,
  target: Extract<DesktopTarget, { supported: true }>,
  hasFuse: boolean,
): { command: string; args: string[]; env: Record<string, string> } {
  if (target.os === 'mac') return { command: 'open', args: [file], env: {} };
  return { command: file, args: [], env: hasFuse && !target.wsl ? {} : { APPIMAGE_EXTRACT_AND_RUN: '1' } };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'omni-cli' } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
  return response.json();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { 'user-agent': 'omni-cli' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Download the build for `target` from `release` into the cache, checked against SHA256SUMS; reuse a checked copy. */
async function fetchBuild(
  release: DesktopRelease,
  target: Extract<DesktopTarget, { supported: true }>,
): Promise<string> {
  const asset = release.assets.find((candidate) => target.asset.test(candidate.name));
  if (!asset) throw new Error(`${release.tag_name} has no ${target.label} build.`);
  const sumsAsset = release.assets.find((candidate) => candidate.name === SUMS_ASSET);
  if (!sumsAsset) throw new Error(`${release.tag_name} has no ${SUMS_ASSET}; refusing an unchecked download.`);
  const expected = parseSums(new TextDecoder().decode(await fetchBytes(sumsAsset.browser_download_url))).get(
    asset.name,
  );
  if (!expected) throw new Error(`${SUMS_ASSET} in ${release.tag_name} does not list ${asset.name}.`);

  const dir = join(appCacheDir(), release.tag_name);
  const file = join(dir, asset.name);
  if (existsSync(file) && sha256Of(readFileSync(file)) === expected) return file;

  mkdirSync(dir, { recursive: true });
  output.info(`Downloading ${asset.name} (${Math.round(asset.size / 1_000_000)} MB)…`);
  const bytes = await fetchBytes(asset.browser_download_url);
  const actual = sha256Of(bytes);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${asset.name}: expected ${expected}, got ${actual}.`);
  const partial = `${file}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, file);
  return file;
}

function open(file: string, target: Extract<DesktopTarget, { supported: true }>): void {
  if (target.os === 'linux') chmodSync(file, 0o755);
  const plan = launchPlan(file, target, existsSync('/dev/fuse'));
  const child = spawn(plan.command, plan.args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...plan.env },
  });
  child.unref();
}

type Supported = Extract<DesktopTarget, { supported: true }>;
type DesktopOptions = { path?: string; tag?: string; dryRun?: boolean };

function openLocal(path: string, target: Supported, dryRun: boolean): void {
  const file = resolve(path);
  if (!existsSync(file)) output.error(`No file at ${file}`);
  if (dryRun) {
    output.info(`Would open ${file} (${target.label})`);
    return;
  }
  open(file, target);
  output.success(`Opened ${file}`);
}

/** The build to open from the releases, or null after saying why there is none (or what a dry run would do). */
async function releaseBuild(target: Supported, options: DesktopOptions): Promise<string | null> {
  const releases = z.array(ReleaseSchema).parse(await fetchJson(RELEASES_URL));
  const release = pickRelease(releases, options.tag);
  if (!release) {
    output.error(
      options.tag
        ? `There is no desktop release ${options.tag}.`
        : `There is no Omni desktop release yet (tags ${DESKTOP_TAG_PREFIX}*). Build one from apps/omni-desktop and open it with --path.`,
    );
  }
  if (options.dryRun) {
    const asset = release.assets.find((candidate) => target.asset.test(candidate.name));
    output.info(`Would download ${asset?.name ?? `(no ${target.label} build)`} from ${release.tag_name}`);
    return null;
  }
  return fetchBuild(release, target);
}

export function createDesktopCommand(): Command {
  return new Command('desktop')
    .description('Open the Omni desktop app (downloads the build for this machine)')
    .option('--path <file>', 'Open this AppImage or dmg instead of downloading one')
    .option('--tag <tag>', `Release to take it from (default: the newest ${DESKTOP_TAG_PREFIX}*)`)
    .option('--dry-run', 'Say what would be downloaded and opened, and stop')
    .action(async (options: DesktopOptions) => {
      const procVersion = existsSync('/proc/version') ? readFileSync('/proc/version', 'utf8') : '';
      const target = desktopTarget(process.platform, process.arch, procVersion);
      if (!target.supported) return output.error(target.reason);
      if (options.path) return openLocal(options.path, target, options.dryRun === true);

      let file: string | null;
      try {
        file = await releaseBuild(target, options);
      } catch (error) {
        return output.error(error instanceof Error ? error.message : String(error));
      }
      if (file === null) return;
      open(file, target);
      output.success(target.os === 'mac' ? `Opened ${file}: drag Omni to Applications` : `Opened ${file}`);
    });
}
