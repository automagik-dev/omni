/**
 * Unit tests for PII scrubbing utilities used by Sentry hooks.
 */

import { describe, expect, test } from 'bun:test';
import {
  type SentryBreadcrumb,
  type SentryEvent,
  type SentrySpan,
  scrubBreadcrumb,
  scrubEvent,
  scrubPii,
  scrubSpan,
  scrubTransaction,
  sentryEnabled,
} from '../sentry-scrub';

// ---------------------------------------------------------------------------
// scrubPii
// ---------------------------------------------------------------------------

describe('scrubPii', () => {
  test('replaces Brazilian phone with country code', () => {
    expect(scrubPii('Call +5511999998888 now')).toBe('Call [phone] now');
  });

  test('replaces phone without + prefix', () => {
    expect(scrubPii('5511999998888')).toBe('[phone]');
  });

  test('replaces international phone with +', () => {
    expect(scrubPii('+14155551234')).toBe('[phone]');
  });

  test('replaces 15-digit phone', () => {
    expect(scrubPii('+551199999888877')).toBe('[phone]');
  });

  test('does NOT replace short numbers (< 10 digits)', () => {
    expect(scrubPii('error code 12345')).toBe('error code 12345');
  });

  test('replaces WhatsApp JID @s.whatsapp.net', () => {
    expect(scrubPii('123456789@s.whatsapp.net')).toBe('[jid]');
  });

  test('replaces WhatsApp JID @c.whatsapp.net', () => {
    expect(scrubPii('5511999998888@c.whatsapp.net')).toBe('[jid]');
  });

  test('replaces email address', () => {
    expect(scrubPii('contact user@example.com please')).toBe('contact [email] please');
  });

  test('replaces complex email', () => {
    expect(scrubPii('john.doe+tag@sub.domain.co.uk')).toBe('[email]');
  });

  test('handles error message with embedded JID', () => {
    const msg = '"5511999998888@s.whatsapp.net" is a UUID but not a known person';
    expect(scrubPii(msg)).toBe('"[jid]" is a UUID but not a known person');
  });

  test('handles multiple PII tokens in one string', () => {
    const input = 'from 5511999998888@s.whatsapp.net to user@example.com via +5511999998888';
    const result = scrubPii(input);
    expect(result).toBe('from [jid] to [email] via [phone]');
  });

  test('clean strings pass through unchanged', () => {
    const clean = 'Instance created successfully at 2024-01-15';
    expect(scrubPii(clean)).toBe(clean);
  });

  test('UUIDs pass through (not treated as phone)', () => {
    const uuid = 'id: a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    // UUID contains hex chars so the digit-only phone regex won't fully match it
    expect(scrubPii(uuid)).toBe(uuid);
  });

  test('normal text with numbers below threshold', () => {
    expect(scrubPii('port 8080 and code 404')).toBe('port 8080 and code 404');
  });
});

// ---------------------------------------------------------------------------
// scrubEvent
// ---------------------------------------------------------------------------

describe('scrubEvent', () => {
  test('strips server_name from event', () => {
    const event: SentryEvent = { server_name: 'prod-worker-01' };
    const result = scrubEvent(event);
    expect(result.server_name).toBeUndefined();
  });

  test('strips server_name from tags', () => {
    const event: SentryEvent = {
      tags: { server_name: 'prod-worker-01', env: 'production' },
    };
    const result = scrubEvent(event);
    expect(result.tags?.server_name).toBeUndefined();
    expect(result.tags?.env).toBe('production');
  });

  test('scrubs exception values', () => {
    const event: SentryEvent = {
      exception: {
        values: [{ type: 'Error', value: 'Failed for 5511999998888@s.whatsapp.net' }],
      },
    };
    const result = scrubEvent(event);
    expect(result.exception?.values?.[0]?.value).toBe('Failed for [jid]');
  });

  test('scrubs event message', () => {
    const event: SentryEvent = {
      message: 'User +5511999998888 disconnected',
    };
    const result = scrubEvent(event);
    expect(result.message).toBe('User [phone] disconnected');
  });

  test('scrubs nested context objects (OmniError context)', () => {
    const event: SentryEvent = {
      extra: {
        omniError: {
          code: 'CHANNEL_NOT_CONNECTED',
          context: {
            instanceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            jid: '5511999998888@s.whatsapp.net',
            phone: '+5511999998888',
          },
        },
      },
    };
    const result = scrubEvent(event);
    const ctx = (result.extra?.omniError as Record<string, unknown>)?.context as Record<string, unknown>;
    expect(ctx.jid).toBe('[jid]');
    expect(ctx.phone).toBe('[phone]');
    // UUID with hex chars should survive
    expect(ctx.instanceId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  test('scrubs request URL and query_string', () => {
    const event: SentryEvent = {
      request: {
        url: 'https://api.omni.dev/v2/messages/5511999998888@s.whatsapp.net',
        query_string: 'phone=5511999998888',
      },
    };
    const result = scrubEvent(event);
    expect(result.request?.url).toBe('https://api.omni.dev/v2/messages/[jid]');
    expect(result.request?.query_string).toBe('phone=[phone]');
  });

  test('scrubs contexts', () => {
    const event: SentryEvent = {
      contexts: {
        channel: { jid: '5511999998888@s.whatsapp.net', type: 'whatsapp' },
      },
    };
    const result = scrubEvent(event);
    expect((result.contexts?.channel as Record<string, unknown>).jid).toBe('[jid]');
    expect((result.contexts?.channel as Record<string, unknown>).type).toBe('whatsapp');
  });

  test('does not mutate original event', () => {
    const event: SentryEvent = {
      server_name: 'host-1',
      message: '+5511999998888',
    };
    scrubEvent(event);
    expect(event.server_name).toBe('host-1');
    expect(event.message).toBe('+5511999998888');
  });
});

// ---------------------------------------------------------------------------
// scrubTransaction
// ---------------------------------------------------------------------------

describe('scrubTransaction', () => {
  test('parameterizes phone in transaction name', () => {
    const event: SentryEvent = { transaction: 'POST /api/v2/messages/5511999998888' };
    const result = scrubTransaction(event);
    expect(result.transaction).toBe('POST /api/v2/messages/:phone');
  });

  test('parameterizes UUID in transaction name', () => {
    const event: SentryEvent = {
      transaction: 'GET /api/v2/instances/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    };
    const result = scrubTransaction(event);
    expect(result.transaction).toBe('GET /api/v2/instances/:uuid');
  });

  test('parameterizes JID in transaction name', () => {
    const event: SentryEvent = {
      transaction: 'SEND 5511999998888@s.whatsapp.net',
    };
    const result = scrubTransaction(event);
    expect(result.transaction).toBe('SEND :jid');
  });

  test('returns event unchanged when no transaction', () => {
    const event: SentryEvent = { message: 'hello' };
    const result = scrubTransaction(event);
    expect(result).toEqual(event);
  });

  test('handles multiple tokens in transaction', () => {
    const event: SentryEvent = {
      transaction: 'ROUTE a1b2c3d4-e5f6-7890-abcd-ef1234567890/5511999998888@s.whatsapp.net',
    };
    const result = scrubTransaction(event);
    expect(result.transaction).toBe('ROUTE :uuid/:jid');
  });
});

// ---------------------------------------------------------------------------
// scrubBreadcrumb
// ---------------------------------------------------------------------------

describe('scrubBreadcrumb', () => {
  test('scrubs PII in breadcrumb message', () => {
    const bc: SentryBreadcrumb = {
      category: 'console',
      message: 'Connected 5511999998888@s.whatsapp.net',
    };
    const result = scrubBreadcrumb(bc);
    expect(result?.message).toBe('Connected [jid]');
  });

  test('scrubs console breadcrumb data', () => {
    const bc: SentryBreadcrumb = {
      category: 'console',
      data: { phone: '+5511999998888', action: 'send' },
    };
    const result = scrubBreadcrumb(bc);
    expect(result?.data?.phone).toBe('[phone]');
    expect(result?.data?.action).toBe('send');
  });

  test('scrubs HTTP URL in breadcrumb data', () => {
    const bc: SentryBreadcrumb = {
      category: 'http',
      data: { url: 'https://api.example.com/users/5511999998888@s.whatsapp.net' },
    };
    const result = scrubBreadcrumb(bc);
    expect(result?.data?.url).toBe('https://api.example.com/users/[jid]');
  });

  test('drops breadcrumbs with message content patterns', () => {
    const bc: SentryBreadcrumb = {
      category: 'console',
      message: 'messageContent: "Hello friend how are you"',
    };
    expect(scrubBreadcrumb(bc)).toBeNull();
  });

  test('drops breadcrumbs with body content patterns', () => {
    const bc: SentryBreadcrumb = {
      category: 'console',
      message: 'body = "secret text here"',
    };
    expect(scrubBreadcrumb(bc)).toBeNull();
  });

  test('passes through clean breadcrumbs', () => {
    const bc: SentryBreadcrumb = {
      category: 'navigation',
      message: '/api/v2/instances',
    };
    const result = scrubBreadcrumb(bc);
    expect(result).toEqual(bc);
  });

  test('does not mutate original breadcrumb', () => {
    const bc: SentryBreadcrumb = {
      message: '5511999998888@s.whatsapp.net',
      data: { jid: '5511999998888@s.whatsapp.net' },
    };
    scrubBreadcrumb(bc);
    expect(bc.message).toBe('5511999998888@s.whatsapp.net');
    expect(bc.data?.jid).toBe('5511999998888@s.whatsapp.net');
  });
});

// ---------------------------------------------------------------------------
// scrubSpan
// ---------------------------------------------------------------------------

describe('scrubSpan', () => {
  test('scrubs db.statement in span data', () => {
    const span: SentrySpan = {
      op: 'db',
      description: 'SELECT * FROM chats',
      data: {
        'db.statement': "SELECT * FROM chats WHERE jid = '5511999998888@s.whatsapp.net'",
      },
    };
    const result = scrubSpan(span);
    expect(result.data?.['db.statement']).toBe("SELECT * FROM chats WHERE jid = '[jid]'");
  });

  test('scrubs http.url in span data', () => {
    const span: SentrySpan = {
      op: 'http.client',
      data: { 'http.url': 'https://wa.me/5511999998888' },
    };
    const result = scrubSpan(span);
    expect(result.data?.['http.url']).toBe('https://wa.me/[phone]');
  });

  test('scrubs span description', () => {
    const span: SentrySpan = {
      op: 'queue.process',
      description: 'process message from +5511999998888',
    };
    const result = scrubSpan(span);
    expect(result.description).toBe('process message from [phone]');
  });

  test('passes through clean spans', () => {
    const span: SentrySpan = {
      op: 'db',
      description: 'SELECT 1',
      data: { 'db.statement': 'SELECT 1' },
    };
    const result = scrubSpan(span);
    expect(result).toEqual(span);
  });

  test('does not mutate original span', () => {
    const span: SentrySpan = {
      description: '+5511999998888',
      data: { 'db.statement': '+5511999998888' },
    };
    scrubSpan(span);
    expect(span.description).toBe('+5511999998888');
    expect(span.data?.['db.statement']).toBe('+5511999998888');
  });
});

// ---------------------------------------------------------------------------
// sentryEnabled
// ---------------------------------------------------------------------------

describe('sentryEnabled', () => {
  test('returns boolean based on Sentry client state', () => {
    // @sentry/bun is installed — sentryEnabled() returns true if a client
    // is configured (which depends on whether Sentry.init was called).
    // It should always return a boolean, never throw.
    const result = sentryEnabled();
    expect(typeof result).toBe('boolean');
  });
});
