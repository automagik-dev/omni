/**
 * The Automagik marketplace at /api/market (see ./service.ts). Public and read-only: the same
 * answer for every caller, built from this release's bundled plugins and the static index.
 *
 *   GET /api/market                        the catalog page, for a person
 *   GET /api/market/index.json             the DSH market index (format 1)
 *   GET /api/market/npm/<name>             a carried plugin's npm packument; 302 to npmjs for any other name
 *   GET /api/market/npm/<name>/-/<file>    a carried plugin's tarball
 *
 * <name> arrives scoped either way npm clients send it: `@scope%2fname` or `@scope/name`.
 * Mounted on the root app before protectedApp (see app.ts).
 */

import { Hono } from 'hono';
import { PackageNameSchema, TarballFileSchema } from './manifest';
import { marketPage } from './page';
import { type Market, upstreamPackumentUrl } from './service';

const SHORT = 'public, max-age=60';
// Without a configured public URL the answer names the request's own origin: a shared cache
// must not hand it to a request for another host.
const PER_ORIGIN = 'private, max-age=60';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const notFound = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;

const decode = (part: string): string | null => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

/** `<name>` or `<name>/-/<file>` after /npm/, validated; null when it is neither. */
function registryPath(pathname: string): { name: string; file?: string } | null {
  const rest = pathname.slice(pathname.indexOf('/npm/') + '/npm/'.length);
  const [rawName = '', rawFile, ...extra] = rest.split('/-/');
  if (extra.length > 0) return null;
  const name = PackageNameSchema.safeParse(decode(rawName));
  if (!name.success) return null;
  if (rawFile === undefined) return { name: name.data };
  const file = TarballFileSchema.safeParse(decode(rawFile));
  return file.success ? { name: name.data, file: file.data } : null;
}

export function marketRoutes(market: Market) {
  const app = new Hono();
  const origin = (url: string) => new URL(url).origin;
  const short = market.fixedOrigin ? SHORT : PER_ORIGIN;

  app.get('/', (c) => {
    c.header('cache-control', short);
    return c.html(marketPage(market.catalog(origin(c.req.url))));
  });

  app.get('/index.json', (c) => {
    c.header('cache-control', short);
    return c.json(market.index(origin(c.req.url)));
  });

  app.get('/npm/*', async (c) => {
    const target = registryPath(new URL(c.req.url).pathname);
    if (!target) return c.json(notFound, 404);
    if (target.file === undefined) {
      const packument = market.packument(target.name, origin(c.req.url));
      c.header('cache-control', short);
      return packument ? c.json(packument) : c.redirect(upstreamPackumentUrl(target.name), 302);
    }
    const bytes = await market.tarball(target.name, target.file);
    if (!bytes) return c.json(notFound, 404);
    return c.body(bytes, 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'cache-control': IMMUTABLE,
    });
  });

  return app;
}
