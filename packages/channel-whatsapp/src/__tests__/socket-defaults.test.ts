/**
 * Regression tests for socket defaults.
 * See: #70
 */

import { describe, expect, it } from 'bun:test';
import { Browsers, generateLoginNode, proto } from 'baileys';
import { DEFAULT_SOCKET_CONFIG, resolveHistoryIdentity } from '../socket';

describe('DEFAULT_SOCKET_CONFIG (#70)', () => {
  it('syncFullHistory is false (prevents meId mutex contention)', () => {
    expect(DEFAULT_SOCKET_CONFIG.syncFullHistory).toBe(false);
  });

  it('defaultQueryTimeoutMs uses Baileys default (60s)', () => {
    expect(DEFAULT_SOCKET_CONFIG.defaultQueryTimeoutMs).toBe(60_000);
  });
});

describe('resolveHistoryIdentity (#1126, #1211)', () => {
  it('defaults to the Windows Desktop identity with group history', () => {
    expect(resolveHistoryIdentity({})).toEqual({ browser: Browsers.windows('Desktop'), supportGroupHistory: true });
  });

  it("'desktop' pairs as Windows Desktop with group history", () => {
    expect(resolveHistoryIdentity({ historyIdentity: 'desktop' })).toEqual({
      browser: Browsers.windows('Desktop'),
      supportGroupHistory: true,
    });
  });

  it("'web' keeps the Ubuntu/Chrome identity without group history", () => {
    expect(resolveHistoryIdentity({ historyIdentity: 'web' })).toEqual({
      browser: Browsers.ubuntu('Chrome'),
      supportGroupHistory: false,
    });
  });

  it('honours per-instance overrides', () => {
    const browser: [string, string, string] = ['Omni', 'Chrome', '1.0'];
    expect(resolveHistoryIdentity({ historyIdentity: 'desktop', browser, supportGroupHistory: false })).toEqual({
      browser,
      supportGroupHistory: false,
    });
  });
});

describe('desktop identity web sub-platform (Baileys#2741)', () => {
  // Since ~2026-06-30 WhatsApp answers WIN32 and DARWIN with a 428 before QR and loops existing
  // sessions. getWebInfo only sends the Desktop sub-platform with syncFullHistory on.
  const webSubPlatform = (browser: [string, string, string]) =>
    generateLoginNode('5511999999999:1@s.whatsapp.net', {
      browser,
      syncFullHistory: true,
      version: [2, 3000, 1],
      countryCode: 'US',
    } as unknown as Parameters<typeof generateLoginNode>[1]).webInfo?.webSubPlatform;

  it('advertises WIN_HYBRID for the default desktop identity (vendored patch)', () => {
    const { browser } = resolveHistoryIdentity({});
    expect(webSubPlatform(browser)).toBe(proto.ClientPayload.WebInfo.WebSubPlatform.WIN_HYBRID);
  });

  it('keeps the web identity on WEB_BROWSER', () => {
    const { browser } = resolveHistoryIdentity({ historyIdentity: 'web' });
    expect(webSubPlatform(browser)).toBe(proto.ClientPayload.WebInfo.WebSubPlatform.WEB_BROWSER);
  });
});
