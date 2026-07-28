/**
 * Fixture-based audit of Sentry scrubbing for whatsapp-cloud events.
 *
 * The wish (`.genie/wishes/whatsapp-cloud-channel/WISH.md`) requires the
 * `beforeSend` hook to mask every sensitive Meta-side field that could leak
 * via error contexts: `text` (message body), E.164 phones, `profile_name`,
 * `verified_name`, `access_token`, and `Bearer …` headers.
 *
 * This test captures a realistic event payload (synthesizing one as if it
 * came from a Graph API failure inside agent-dispatcher or webhook handling)
 * and verifies that:
 *   1. No raw phone number remains in the event.
 *   2. No raw Meta access token remains in the event.
 *   3. The freeform message text is masked.
 *   4. The profile_name + verified_name are masked.
 *   5. The Bearer header is masked.
 *
 * If this test ever fails, audit `packages/api/src/lib/sentry-scrub.ts` —
 * one of the masking rules was loosened or a new field path was added that
 * doesn't go through the deep walker.
 */

import { describe, expect, test } from 'bun:test';
import { scrubBreadcrumb, scrubEvent } from '../sentry-scrub';

/** Synthesized event reflecting what we'd capture if a Meta send failed. */
function buildRealisticMetaEvent() {
  // Synthetic low-entropy fixture (repeated single char) so secret-scanners
  // don't flag this audit harness as a real Meta token leak.
  const accessToken = `EAA${'a'.repeat(80)}`;
  return {
    event_id: 'evt_test_meta',
    message: `Failed to send message to +5511999998888 (wamid.HBgL... ) — token ${accessToken}`,
    transaction: 'POST /api/v2/messages',
    exception: {
      values: [
        {
          type: 'MetaApiError',
          value: `OUTSIDE_24H_WINDOW: cannot send free-form to +5511999998888 — wamid.abc123`,
        },
      ],
    },
    breadcrumbs: [
      {
        type: 'http',
        category: 'fetch',
        message: 'POST https://graph.facebook.com/v25.0/107654321987654/messages',
        data: {
          method: 'POST',
          url: 'https://graph.facebook.com/v25.0/107654321987654/messages',
          status_code: 400,
          requestHeaders: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
        level: 'error',
      },
    ],
    contexts: {
      meta: {
        phone_number_id: '107654321987654',
        waba_id: '102030405060708',
        display_phone_number: '+55 11 99999-8888',
        profile_name: 'João da Silva',
        verified_name: 'Acme Inc.',
        access_token: accessToken,
      },
      send_attempt: {
        to: '+5511999998888',
        text: 'olá, tudo bem? gostaria de saber se você ainda está interessado',
        caption: 'Confira nosso catálogo abaixo',
      },
    },
    extra: {
      meta_error: {
        code: 131047,
        message: 'Message failed to send because more than 24 hours have passed since the last message',
        fbtrace_id: 'AaBbCcDdEeFf',
      },
      retry_context: {
        token: accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
    },
    tags: {
      channel: 'whatsapp-cloud',
      'error.code': 'OMNI_OUTSIDE_24H_WINDOW',
      'http.url': '/api/v2/messages/+5511999998888',
    },
    request: {
      url: 'https://omni.example.com/api/v2/messages?to=+5511999998888',
      query_string: 'to=+5511999998888&template=welcome',
      data: undefined,
    },
  };
}

describe('Sentry scrubbing — whatsapp-cloud audit fixture', () => {
  const event = buildRealisticMetaEvent();
  const original = JSON.stringify(event);
  const result = scrubEvent(event as Parameters<typeof scrubEvent>[0]);

  test('no raw +E.164 phone leaks anywhere in the event', () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('+5511999998888');
    expect(serialized).not.toContain('5511999998888');
  });

  test('no raw Meta access token leaks anywhere in the event', () => {
    const serialized = JSON.stringify(result);
    // EAA prefix should never appear in scrubbed output (long-token regex catches it).
    expect(/EAA[A-Za-z0-9_-]{40,}/.test(serialized)).toBe(false);
  });

  test('contexts.meta.profile_name and verified_name are redacted', () => {
    const meta = (result.contexts?.meta ?? {}) as Record<string, unknown>;
    expect(meta.profile_name).toBe('[redacted]');
    expect(meta.verified_name).toBe('[redacted]');
    expect(meta.access_token).toBe('[redacted]');
  });

  test('contexts.send_attempt.text and caption (message body) are redacted', () => {
    const send = (result.contexts?.send_attempt ?? {}) as Record<string, unknown>;
    expect(send.text).toBe('[redacted]');
    expect(send.caption).toBe('[redacted]');
    // `to` (phone field — non-sensitive key) is pattern-scrubbed instead.
    expect(send.to).toBe('[phone]');
  });

  test('extra.retry_context.Authorization (Bearer header) is redacted by key', () => {
    const ctx = (result.extra as Record<string, unknown>).retry_context as Record<string, unknown>;
    // `authorization` is a sensitive key — full redaction.
    expect(ctx.Authorization).toBe('[redacted]');
    // raw `token` field IS sensitive too (matches `access_token` family? no — only specific keys)
    // The plain key "token" is not in SENSITIVE_KEYS, but the value matches META_ACCESS_TOKEN_RE
    // so should come out as [meta_token].
    expect(ctx.token).toBe('[meta_token]');
  });

  test('breadcrumb HTTP request data has Authorization redacted and URL phone-scrubbed', () => {
    const bc = result.breadcrumbs?.[0];
    expect(bc).toBeDefined();
    const data = (bc?.data ?? {}) as Record<string, unknown>;
    const headers = data.requestHeaders as Record<string, unknown> | undefined;
    expect(headers?.Authorization).toBe('[redacted]');
    expect(String(data.url)).not.toMatch(/EAA[A-Za-z0-9_-]{40,}/);
    // URL contains phone_number_id (15 digits) → phone-scrubbed.
    expect(String(data.url)).toContain('[phone]');
  });

  test('tags["http.url"] is phone-scrubbed', () => {
    expect(result.tags?.['http.url']).toBe('/api/v2/messages/[phone]');
  });

  test('request.url and request.query_string are phone-scrubbed', () => {
    expect(result.request?.url).toContain('[phone]');
    expect(result.request?.query_string).toContain('[phone]');
  });

  test('exception.values[].value gets PII scrubbed', () => {
    const ex = result.exception?.values?.[0];
    expect(ex?.value).not.toContain('+5511999998888');
    expect(ex?.value).toContain('[phone]');
  });

  test('top-level message is scrubbed of phone + token', () => {
    expect(result.message).not.toContain('+5511999998888');
    expect(result.message).not.toMatch(/EAA[A-Za-z0-9_-]{40,}/);
    expect(result.message).toContain('[phone]');
    expect(result.message).toContain('[meta_token]');
  });

  test('original event object is not mutated', () => {
    expect(JSON.stringify(event)).toBe(original);
  });
});

describe('Sentry scrubbing — whatsapp-cloud breadcrumb edge cases', () => {
  test('breadcrumb with embedded "text:" pattern is dropped (existing rule)', () => {
    const bc = {
      type: 'log',
      message: 'agent reply: text: "olá cliente"',
      data: { instanceId: '123' },
    };
    expect(scrubBreadcrumb(bc)).toBeNull();
  });

  test('breadcrumb without body-content hint passes through with PII scrubbed', () => {
    const bc = {
      type: 'log',
      message: 'Sending to +5511999998888 with wamid',
      data: { authorization: `Bearer ${'x'.repeat(40)}` },
    };
    const scrubbed = scrubBreadcrumb(bc);
    expect(scrubbed?.message).toContain('[phone]');
    expect((scrubbed?.data as Record<string, unknown>).authorization).toBe('[redacted]');
  });
});
