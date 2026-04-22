/**
 * Contract tests for the 5 code-defined profile templates.
 *
 * These tests are the snapshot of what each profile resolves to — any
 * change to a template or to a bucket's underlying scopes is an
 * intentional behavior change and must update this file deliberately.
 */

import { describe, expect, test } from 'bun:test';

import { verbsToScopes } from '../../lib/verbs-to-scopes';
import { COWORKER_DEFAULT_DENYLIST_PRESET_KEY, PROFILES, type ProfileName } from '../profiles';

/** Resolve a profile template exactly the way the key-creation route will. */
function resolveTemplateScopes(name: ProfileName): string[] {
  const template = PROFILES[name];
  return verbsToScopes({
    buckets: [...template.buckets, ...(template.defaultOverrides?.extraBuckets ?? [])],
    verbs: template.verbs,
    extraScopes: template.defaultOverrides?.extraScopes,
  });
}

describe('PROFILES registry', () => {
  test('exports exactly the 5 documented profiles', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(['admin', 'coworker', 'cs', 'personal', 'scout']);
  });
});

describe('cs profile', () => {
  const template = PROFILES.cs;

  test('requires chatAllowlist and instanceAllowlist at create time', () => {
    expect(template.requiresLocks).toContain('chatAllowlist');
    expect(template.requiresLocks).toContain('instanceAllowlist');
  });

  test('multimodal buckets are OFF by default (enterprise opt-in)', () => {
    expect(template.buckets).not.toContain('multimodal_in');
    expect(template.buckets).not.toContain('multimodal_out');
  });

  test('is not admin-only', () => {
    expect(template.adminOnlyFlag).toBeUndefined();
  });

  test('resolves to the documented scope set (no instances:read — use is removed)', () => {
    expect(resolveTemplateScopes('cs')).toEqual(['chats:read', 'context:write', 'messages:send', 'turns:close']);
  });

  test('does NOT grant instances:read — `use` verb is stripped from the context bucket', () => {
    expect(resolveTemplateScopes('cs')).not.toContain('instances:read');
  });
});

describe('personal profile', () => {
  const template = PROFILES.personal;

  test('requires instanceAllowlist at create time', () => {
    expect(template.requiresLocks).toEqual(['instanceAllowlist']);
  });

  test('enables the full verb surface including multimodal', () => {
    expect(template.buckets).toEqual(['outgoing', 'read', 'context', 'turn', 'multimodal_in', 'multimodal_out']);
  });

  test('resolves to the full scope surface', () => {
    expect(resolveTemplateScopes('personal')).toEqual([
      'chats:read',
      'context:write',
      'instances:read',
      'media:read',
      'media:write',
      'messages:send',
      'tts:synthesize',
      'turns:close',
    ]);
  });
});

describe('scout profile', () => {
  const template = PROFILES.scout;

  test('requires outboundRecipientAllowlist at create time', () => {
    expect(template.requiresLocks).toEqual(['outboundRecipientAllowlist']);
  });

  test('outboundRecipientAllowlist is locked — tenants cannot widen it', () => {
    expect(template.lockedOverrides).toContain('outboundRecipientAllowlist');
  });

  test('has no outgoing bucket — only a gated messages:send extra scope', () => {
    expect(template.buckets).not.toContain('outgoing');
    expect(template.defaultOverrides?.extraScopes).toContain('messages:send');
  });

  test('resolves to read-heavy scope set plus gated messages:send', () => {
    expect(resolveTemplateScopes('scout')).toEqual([
      'chats:read',
      'context:write',
      'instances:read',
      'media:read',
      'messages:send',
    ]);
  });

  test('keeps chats:read (from `where`) even though `history` is removed', () => {
    // `where` and `history` both map to `chats:read` today, so the set is
    // identical by count. The structural commitment — scout may locate the
    // current chat but NEVER ingest prior history — is encoded in the
    // template's verbs.add/remove and survives a future scope split such
    // as `chats:history:read`.
    const scopes = resolveTemplateScopes('scout');
    expect(scopes).toContain('chats:read');
    expect(PROFILES.scout.verbs?.add).toContain('where');
    expect(PROFILES.scout.verbs?.remove).toContain('history');
  });
});

describe('coworker profile', () => {
  const template = PROFILES.coworker;

  test('requires instanceAllowlist at create time', () => {
    expect(template.requiresLocks).toEqual(['instanceAllowlist']);
  });

  test('defaults outputDenylist to the documented preset pointer', () => {
    expect(template.defaultOverrides?.denylistPresetKey).toBe(COWORKER_DEFAULT_DENYLIST_PRESET_KEY);
  });

  test('resolves to the full scope surface (redaction is output-layer, not a scope)', () => {
    expect(resolveTemplateScopes('coworker')).toEqual([
      'chats:read',
      'context:write',
      'instances:read',
      'media:read',
      'media:write',
      'messages:send',
      'tts:synthesize',
      'turns:close',
    ]);
  });
});

describe('admin profile', () => {
  const template = PROFILES.admin;

  test('is flagged adminOnly — non-TTY callers must be rejected', () => {
    expect(template.adminOnlyFlag).toBe(true);
  });

  test('has no required locks (god key)', () => {
    expect(template.requiresLocks).toEqual([]);
  });

  test('resolves to the full scope surface', () => {
    expect(resolveTemplateScopes('admin')).toEqual([
      'chats:read',
      'context:write',
      'instances:read',
      'media:read',
      'media:write',
      'messages:send',
      'tts:synthesize',
      'turns:close',
    ]);
  });
});
