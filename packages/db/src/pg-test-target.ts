/** Side-effect-free target validation shared by test helpers and the PostgreSQL gate. */
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import postgres from 'postgres';

/**
 * Every opt-in variable a `*-postgres.test.ts` in this repository reads. The
 * single list: the suite harness checks each at load, and the gate sets each.
 */
export const POSTGRES_URL_VARS = [
  'OMNI_G1_POSTGRES_URL',
  'OMNI_G2_POSTGRES_URL',
  'OMNI_G3_POSTGRES_URL',
  'OMNI_G4_POSTGRES_URL',
  'OMNI_G6_POSTGRES_URL',
] as const;

/** Refuse ambiguous or shared targets before either postgres.js or psql opens a connection. */
export function assertPgTestTarget(url: string, env: Record<string, string | undefined> = process.env): void {
  const refuse = (reason: string): never => {
    throw new Error(`Unsafe PostgreSQL test target: ${reason}`);
  };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject controls before the drivers normalize them differently
  if (/[\s\x00-\x1f\x7f]/.test(url)) refuse('raw whitespace and control characters are not allowed');
  if (url.includes('#')) refuse('URL fragments are not allowed');
  // Inspect the raw authority first: WHATWG and PostgreSQL drivers disagree
  // about comma host lists and whether the first or last @ ends user info.
  const authorityMatch = url.match(/^[a-z][a-z\d+.-]*:\/\/([^/?]*)/i);
  const authority = authorityMatch?.[1] ?? '';
  const authorityEnd = authorityMatch?.[0].length ?? 0;
  // libpq searches for userinfo before splitting on '?', unlike postgres.js.
  // A raw @ anywhere outside the authority can therefore select another host.
  if (authority.includes(',') || url.split('@').length > 2 || url.indexOf('@', authorityEnd) !== -1) {
    refuse('single-host URLs with at most one raw @ separator inside the authority are required');
  }
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) refuse('expected a PostgreSQL URL');
  if (['host', 'hostaddr', 'port', 'service'].some((key) => parsed.searchParams.has(key))) {
    refuse('query host/port/service selectors differ between drivers; use PGHOST/PGPORT or an explicit gate URL');
  }
  if (env.PGHOSTADDR || env.PGSERVICE) refuse('PGHOSTADDR and PGSERVICE overrides are not allowed');
  const port = parsed.port || env.PGPORT || '';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || [5432, 15432].includes(Number(port))) {
    refuse('an explicit disposable port is required; 5432 and 15432 are forbidden');
  }
  if (!parsed.hostname) {
    if (!isTemporarySocketDirectory(env.PGHOST ?? ''))
      refuse('hostless URLs require PGHOST under a temporary directory');
  } else if (parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.host !== env.OMNI_PG_TEST_TARGET) {
    refuse('TCP must match the gate-registered 127.0.0.1:port target');
  }
  assertDriverTarget(url, parsed, env, port);
}

/** Parse with the actual driver without issuing a query or opening a socket.
 * Only supply hostless env fallbacks; overriding a URL's host/port would hide
 * precisely the parser disagreements this check must detect.
 */
function assertDriverTarget(url: string, parsed: URL, env: Record<string, string | undefined>, port: string): void {
  const client = postgres(url, {
    ...(!parsed.hostname ? { host: env.PGHOST } : {}),
    ...(!parsed.port ? { port: Number(env.PGPORT) } : {}),
  });
  try {
    const expectedHost = parsed.hostname || env.PGHOST;
    const options = client.options;
    const matches =
      options.host.length > 0 &&
      options.host.length === options.port.length &&
      options.host.every((host, index) => host === expectedHost && options.port[index] === Number(port));
    const expectedPath = parsed.hostname ? undefined : `${expectedHost}/.s.PGSQL.${Number(port)}`;
    if (!matches || (options.path || undefined) !== expectedPath) {
      throw new Error('Unsafe PostgreSQL test target: postgres.js resolved a different host, port or socket path');
    }
  } finally {
    // postgres.js is lazy: no query means no connection to close.
    void client.end({ timeout: 0 });
  }
}

function isTemporarySocketDirectory(host: string): boolean {
  if (!isAbsolute(host)) return false;
  try {
    const target = realpathSync(host);
    return [tmpdir(), '/tmp'].some((root) => {
      const path = relative(realpathSync(root), target);
      return path !== '' && path !== '..' && !path.startsWith('../') && !isAbsolute(path);
    });
  } catch {
    return false;
  }
}
