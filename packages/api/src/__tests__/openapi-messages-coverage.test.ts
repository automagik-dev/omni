/**
 * Every route mounted by routes/v2/messages.ts must have an OpenAPI path
 * entry, so a new endpoint cannot ship undocumented (#1218).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openApiSpec } from '../routes/openapi';

// ponytail: pre-existing undocumented routes, grandfathered. Shrink-only — the
// second test fails once one gets documented so the entry is removed.
const KNOWN_UNDOCUMENTED = new Set([
  'get /messages/{id}/permalink',
  'get /messages',
  'get /messages/by-external',
  'post /messages/media/download',
  'get /messages/{id}',
  'patch /messages/{id}',
  'delete /messages/{id}',
  'post /messages/{id}/edit',
  'post /messages/{id}/reactions',
  'delete /messages/{id}/reactions',
  'patch /messages/{id}/delivery-status',
  'patch /messages/{id}/transcription',
  'patch /messages/{id}/image-description',
  'patch /messages/{id}/video-description',
  'patch /messages/{id}/document-extraction',
  'post /messages/send',
  'post /messages/send/reaction',
  'post /messages/send/sticker',
  'post /messages/send/contact',
  'post /messages/send/location',
  'post /messages/send/forward',
  'post /messages/send/poll',
  'post /messages/send/embed',
  'post /messages/edit-channel',
  'post /messages/delete-channel',
  'post /messages/{id}/star',
  'delete /messages/{id}/star',
]);

const source = readFileSync(join(import.meta.dir, '../routes/v2/messages.ts'), 'utf8');
const routes = [...source.matchAll(/messagesRoutes\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)].map(
  ([, method, path]) => `${method} /messages${path === '/' ? '' : path}`.replace(/:(\w+)/g, '{$1}'),
);

function documented(route: string): boolean {
  const [method, path] = route.split(' ') as [string, string];
  return Boolean((openApiSpec.paths?.[path] as Record<string, unknown> | undefined)?.[method]);
}

describe('openapi messages coverage', () => {
  it('finds the message routes', () => {
    expect(routes).toContain('post /messages/send/close-contact');
  });

  it('documents every message route', () => {
    expect(routes.filter((r) => !documented(r) && !KNOWN_UNDOCUMENTED.has(r))).toEqual([]);
  });

  it('keeps the grandfather list current', () => {
    expect([...KNOWN_UNDOCUMENTED].filter((r) => !routes.includes(r) || documented(r))).toEqual([]);
  });
});
