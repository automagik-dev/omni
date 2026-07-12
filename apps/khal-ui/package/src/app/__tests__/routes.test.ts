import { describe, expect, test } from 'bun:test';
import { routes } from '../routes';
import { ALL_NAV_ITEMS, SITEMAP } from '../sitemap';

/** Flatten the router config (skipping the layout root) into concrete paths. */
function routedPaths(): Set<string> {
  const out = new Set<string>();
  const children = routes[0]?.children ?? [];
  for (const child of children) {
    if ('index' in child && child.index) out.add('/');
    else if ('path' in child && child.path && child.path !== '*') out.add(`/${child.path}`);
  }
  return out;
}

describe('sitemap', () => {
  test('has the six expected groups', () => {
    expect(SITEMAP.map((g) => g.id)).toEqual([
      'home',
      'messaging',
      'agents',
      'channels',
      'operations',
      'configuration',
    ]);
  });

  test('every path is unique', () => {
    const paths = ALL_NAV_ITEMS.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test('contains the full required route set', () => {
    const paths = new Set(ALL_NAV_ITEMS.map((i) => i.path));
    const required = [
      '/',
      '/health',
      '/activity',
      '/chat',
      '/conversations',
      '/persons',
      '/contacts',
      '/groups',
      '/journeys',
      '/voice',
      '/agents',
      '/providers',
      '/automations',
      '/batch-jobs',
      '/instances',
      '/webhook-sources',
      '/access-rules',
      '/routing',
      '/events',
      '/event-ops',
      '/dead-letters',
      '/logs',
      '/metrics',
      '/settings',
      '/payload-config',
      '/tts-voices',
      '/api-keys',
      '/trust-hosts',
      '/media-console',
      '/turns',
      '/context',
      '/handoffs',
      '/a2a',
      '/api-info',
      '/dev/capabilities',
    ];
    for (const path of required) expect(paths.has(path)).toBe(true);
  });
});

describe('routes', () => {
  test('every sitemap item has a matching route (no 404s)', () => {
    const routed = routedPaths();
    for (const item of ALL_NAV_ITEMS) {
      expect(routed.has(item.path)).toBe(true);
    }
  });

  test('includes a catch-all so unknown paths still render a shell page', () => {
    const children = routes[0]?.children ?? [];
    expect(children.some((c) => 'path' in c && c.path === '*')).toBe(true);
  });

  test('the four live pages are wired as index/real routes', () => {
    const routed = routedPaths();
    for (const path of ['/', '/health', '/activity', '/dev/capabilities']) {
      expect(routed.has(path)).toBe(true);
    }
  });
});
