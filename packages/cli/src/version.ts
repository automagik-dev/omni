import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_VERSION_HEADER = 'x-omni-cli-version';
export const SERVER_VERSION_HEADER = 'x-omni-server-version';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

function readVersionFromArtifact(): string | null {
  const vj = readJsonFile(join(__dirname, '..', '..', '..', 'version.json'));
  return (vj?.version as string) || null;
}

/** Read the short git hash directly from .git/HEAD (no subprocess needed) */
function readGitHash(repoRoot: string): string | null {
  try {
    const headPath = join(repoRoot, '.git', 'HEAD');
    if (!existsSync(headPath)) return null;
    const head = readFileSync(headPath, 'utf-8').trim();

    let fullHash: string;
    if (head.startsWith('ref: ')) {
      // Symbolic ref — e.g. "ref: refs/heads/main"
      const refPath = join(repoRoot, '.git', head.slice(5));
      if (!existsSync(refPath)) return null;
      fullHash = readFileSync(refPath, 'utf-8').trim();
    } else {
      // Detached HEAD — raw commit hash
      fullHash = head;
    }

    return fullHash.length >= 7 ? fullHash.slice(0, 7) : null;
  } catch {
    return null;
  }
}

function readVersionFromPackage(): string {
  const pkg = readJsonFile(join(__dirname, '..', 'package.json'));
  let version = (pkg?.version as string) || '0.0.1';
  const hash = readGitHash(join(__dirname, '..', '..', '..'));
  if (hash) version += `+${hash}`;
  return version;
}

function detectVersion(): string {
  return readVersionFromArtifact() ?? readVersionFromPackage();
}

export const VERSION = detectVersion();

export async function fetchServerVersion(apiUrl: string, timeoutMs = 800): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${apiUrl.replace(/\/$/, '')}/api/v2/health`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'identity',
        [CLI_VERSION_HEADER]: VERSION,
      },
      signal: controller.signal,
    });

    return response.headers.get(SERVER_VERSION_HEADER);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatStatusVersionHint(localVersion: string, serverVersion: string): string {
  if (localVersion === serverVersion) {
    return `Version: ${localVersion} ✓`;
  }

  return `Version: cli ${localVersion} ↔ server ${serverVersion} (run: omni update)`;
}

export function formatCliVersionLine(localVersion: string, serverVersion: string | null): string {
  if (!serverVersion) {
    return localVersion;
  }

  if (localVersion === serverVersion) {
    return `${localVersion} (server: ${serverVersion} ✓)`;
  }

  return `${localVersion} (server: ${serverVersion} ↑ update available)`;
}
