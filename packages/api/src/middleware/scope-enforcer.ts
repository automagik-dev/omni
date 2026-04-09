/**
 * Scope enforcement middleware — deny-by-default authorization for all v2 routes.
 *
 * Runs AFTER authMiddleware (which sets c.get("apiKey")).
 * Matches METHOD + path against SCOPE_MAP, checks key scopes via ApiKeyService.scopeAllows().
 * Keys with "*" scope bypass all checks. Unmapped routes get 403.
 */

import { createLogger } from '@omni/core';
import { createMiddleware } from 'hono/factory';
import { SCOPE_MAP } from '../constants/scopes';
import { ApiKeyService } from '../services/api-keys';
import type { AppVariables } from '../types';

const log = createLogger('api:scope-enforcer');

/**
 * Build a regex that matches the static segments of a pattern path,
 * replacing :param segments with a non-slash matcher.
 */
function buildSegmentRegex(patternPath: string): RegExp {
  const escaped = patternPath
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}$`);
}

/** Check if a wildcard pattern (ending in /*) matches the path. */
function matchesWildcard(patternPath: string, cleanPath: string): boolean {
  const prefix = patternPath.slice(0, -2); // remove /*
  const prefixRegex = buildSegmentRegex(prefix);
  return prefixRegex.test(cleanPath) || new RegExp(`^${prefixRegex.source.slice(0, -1)}/.+$`).test(cleanPath);
}

/** Check if a parameterized pattern matches the path segment-by-segment. */
function matchesSegments(patternPath: string, cleanPath: string): boolean {
  const patternSegments = patternPath.split('/');
  const pathSegments = cleanPath.split('/');

  if (patternSegments.length !== pathSegments.length) return false;

  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i]?.startsWith(':')) continue;
    if (patternSegments[i] !== pathSegments[i]) return false;
  }
  return true;
}

/** Strip /api/v2 prefix and trailing slash from a request path. */
function normalizePath(path: string): string {
  const stripped = path.replace(/^\/api\/v2/, '');
  return stripped.endsWith('/') && stripped.length > 1 ? stripped.slice(0, -1) : stripped;
}

/**
 * Find the required scope for a given HTTP method + path by matching against SCOPE_MAP.
 */
function findRequiredScope(method: string, path: string): string | undefined {
  const cleanPath = normalizePath(path);

  // Fast path: exact match
  const exactKey = `${method} ${cleanPath}`;
  if (SCOPE_MAP[exactKey]) return SCOPE_MAP[exactKey];

  // Pattern matching against SCOPE_MAP entries
  for (const [pattern, scope] of Object.entries(SCOPE_MAP)) {
    const spaceIdx = pattern.indexOf(' ');
    const patternMethod = pattern.slice(0, spaceIdx);
    if (patternMethod !== method) continue;

    const patternPath = pattern.slice(spaceIdx + 1);

    if (patternPath.endsWith('/*')) {
      if (matchesWildcard(patternPath, cleanPath)) return scope;
      continue;
    }

    if (matchesSegments(patternPath, cleanPath)) return scope;
  }

  return undefined;
}

export const scopeEnforcerMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const apiKey = c.get('apiKey');

  // authMiddleware should have set this — if missing, deny
  if (!apiKey) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401,
    );
  }

  // Admin bypass: keys with "*" scope pass everything
  if (ApiKeyService.scopeAllows(apiKey.scopes, '*')) {
    return next();
  }

  const method = c.req.method.toUpperCase();
  const path = c.req.path;

  const requiredScope = findRequiredScope(method, path);

  // Deny-by-default: no mapping means forbidden
  if (!requiredScope) {
    log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} required=UNMAPPED`);
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions. Route not mapped in scope policy.',
        },
      },
      403,
    );
  }

  // Check if the key's scopes include the required scope
  if (!ApiKeyService.scopeAllows(apiKey.scopes, requiredScope)) {
    log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} required=${requiredScope}`);
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient permissions. Required scope: ${requiredScope}`,
        },
      },
      403,
    );
  }

  return next();
});
