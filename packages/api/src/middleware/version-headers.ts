/**
 * Version handshake middleware
 *
 * Adds server version metadata to all responses and emits a mismatch hint
 * when the incoming CLI version differs from server version.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMiddleware } from 'hono/factory';
import type { AppVariables } from '../types';

interface VersionFile {
  version?: string;
  commit?: string;
}

interface ServerVersionInfo {
  version: string;
  commit: string;
}

const FALLBACK_VERSION = '2.0.0';
const FALLBACK_COMMIT = 'unknown';

function loadServerVersionInfo(): ServerVersionInfo {
  try {
    for (const candidate of [
      join(import.meta.dir, '..', '..', '..', '..', 'version.json'),
      join(process.cwd(), 'version.json'),
    ]) {
      if (!existsSync(candidate)) {
        continue;
      }

      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as VersionFile;
      return {
        version: parsed.version ?? FALLBACK_VERSION,
        commit: parsed.commit ?? FALLBACK_COMMIT,
      };
    }
  } catch {
    // Ignore file/parse errors and use fallback below.
  }

  return {
    version: FALLBACK_VERSION,
    commit: FALLBACK_COMMIT,
  };
}

// Read once at startup; reused for every request.
const SERVER_VERSION_INFO = loadServerVersionInfo();

export const versionHeadersMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  c.res.headers.set('x-omni-server-version', SERVER_VERSION_INFO.version);
  c.res.headers.set('x-omni-server-commit', SERVER_VERSION_INFO.commit);

  const cliVersion = c.req.header('x-omni-cli-version');
  if (cliVersion && cliVersion !== SERVER_VERSION_INFO.version) {
    c.res.headers.set('x-omni-version-mismatch', 'true');
  }

  await next();
});
