/**
 * Hono matches a router's routes in registration order, so a literal route declared
 * after a parameter route of the same shape is unreachable: `GET /chats/by-external`
 * after `GET /chats/:id` answered "Chat not found: by-external". Literal routes go first.
 * Read from the source of every v2 router, like the mount-order test, with no database.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const V2_DIR = join(import.meta.dir, '..');

interface Route {
  method: string;
  path: string;
}

function shadowed(source: string): string[] {
  const found: string[] = [];
  const idents = new Set(
    [...source.matchAll(/\b(\w+Routes)\.(?:get|post|put|patch|delete)\(/g)].map(([, ident]) => ident),
  );
  for (const ident of idents) {
    const routes: Route[] = [
      ...source.matchAll(new RegExp(`\\b${ident}\\.(get|post|put|patch|delete)\\(\\s*'([^']*)'`, 'g')),
    ].map(([, method = '', path = '']) => ({ method, path }));
    routes.forEach((route, index) => {
      const segments = route.path.split('/').filter(Boolean);
      const earlier = routes.slice(0, index).find((other) => {
        const others = other.path.split('/').filter(Boolean);
        return (
          other.method === route.method &&
          others.length === segments.length &&
          others.every((part, at) => part === segments[at] || part.startsWith(':')) &&
          others.some((part, at) => part.startsWith(':') && !segments[at]?.startsWith(':'))
        );
      });
      if (earlier)
        found.push(`${route.method.toUpperCase()} ${route.path} after ${earlier.method.toUpperCase()} ${earlier.path}`);
    });
  }
  return found;
}

describe('v2 route shadowing', () => {
  it('catches a literal route declared after a parameter route', () => {
    expect(shadowed("xRoutes.get('/:id', h)\nxRoutes.get('/by-external', h)")).toEqual([
      'GET /by-external after GET /:id',
    ]);
    expect(shadowed("xRoutes.get('/by-external', h)\nxRoutes.get('/:id', h)")).toEqual([]);
  });

  it('declares every literal route before the parameter routes that would take it', () => {
    const files = readdirSync(V2_DIR).filter((file) => file.endsWith('.ts'));
    const problems = files.flatMap((file) =>
      shadowed(readFileSync(join(V2_DIR, file), 'utf8')).map((line) => `${file}: ${line}`),
    );
    expect(problems).toEqual([]);
  });
});
