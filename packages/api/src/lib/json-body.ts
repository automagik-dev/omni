/**
 * One JSON-body reader for the lock middlewares (scope-enforcer,
 * require-signed-instance), matching what the routes' `zValidator('json')` parses.
 */
import type { Context } from 'hono';
import type { AppVariables } from '../types';

/**
 * Hono's own test for a JSON body (`hono/validator` in hono 4.12.18):
 * `application/json` and every `application/*+json`. The lock must read every
 * body the route validator reads, or a body it skips could name a target the
 * lock never checked.
 */
const HONO_JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/;

/** True when the route's JSON validator would parse a body with this content type (or the lock always has). */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return HONO_JSON_CONTENT_TYPE.test(contentType) || contentType.toLowerCase().includes('application/json');
}

/**
 * Parse a JSON request body. Returns null when the method has no body or the
 * body isn't JSON; the lock then skips body-derived targets. Hono caches the
 * parsed JSON on the request, so the route's validator does not parse it again.
 */
export async function safeReadJsonBody(c: Context<{ Variables: AppVariables }>): Promise<unknown | null> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (!isJsonContentType(c.req.header('content-type'))) return null;
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
