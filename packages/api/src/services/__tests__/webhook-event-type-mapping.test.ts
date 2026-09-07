/**
 * Source→semantic-type mapping for the generic webhook ingress (issue #959).
 *
 * A mapped source extracts the semantic event name from the delivery
 * (`X-GitHub-Event: push` → `custom.github.push`) instead of collapsing every
 * delivery into `custom.webhook.{source}`; anything the mapping cannot
 * resolve falls back to the collapsed legacy type.
 */

import { describe, expect, test } from 'bun:test';
import { resolveWebhookEventType } from '../webhooks';

const GITHUB_MAPPING = { source: 'header', header: 'X-GitHub-Event' } as const;

describe('resolveWebhookEventType', () => {
  test('a mapped source emits custom.{source}.{event} from the header', () => {
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': 'push' })).toBe('custom.github.push');
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': 'pull_request' })).toBe(
      'custom.github.pull_request',
    );
  });

  test('no mapping keeps the legacy collapsed type', () => {
    expect(resolveWebhookEventType('github', null, { 'x-github-event': 'push' })).toBe('custom.webhook.github');
  });

  test('a delivery without the mapped header falls back to the collapsed type', () => {
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, {})).toBe('custom.webhook.github');
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': '' })).toBe('custom.webhook.github');
  });

  test('the header value is normalized into a safe event-type token', () => {
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': ' Pull Request ' })).toBe(
      'custom.github.pull-request',
    );
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': 'a.b/c' })).toBe(
      'custom.github.a-b-c',
    );
  });

  test('a header value with nothing usable falls back to the collapsed type', () => {
    expect(resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': '///' })).toBe(
      'custom.webhook.github',
    );
  });

  test('an oversized header value is capped at 64 characters', () => {
    const eventType = resolveWebhookEventType('github', GITHUB_MAPPING, { 'x-github-event': 'x'.repeat(200) });
    expect(eventType).toBe(`custom.github.${'x'.repeat(64)}`);
  });
});
