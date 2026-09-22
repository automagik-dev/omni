import { describe, expect, test } from 'bun:test';
import { minimalPatch } from './config-schemas';
import {
  PRODUCTION_INSTANCE_IDS,
  channelLabel,
  connStateDot,
  deriveSendReceiveProof,
  isProductionInstance,
  isQrImage,
  isWhatsApp,
  normalizeConnState,
  readSlackReturnNonce,
  slackMissingKeysText,
  stripSlackReturnParam,
} from './instance-helpers';

describe('production guard', () => {
  test('recognises the two live production instances', () => {
    expect(PRODUCTION_INSTANCE_IDS).toHaveLength(2);
    expect(isProductionInstance('506377b1-eb79-4ae3-abc1-80bd00986f6b')).toBe(true);
    expect(isProductionInstance('11c1a3e2-bb53-45df-aac8-0418f44ea5d5')).toBe(true);
  });
  test('treats disposable and unknown ids as non-production', () => {
    expect(isProductionInstance('zz-test-123')).toBe(false);
    expect(isProductionInstance(null)).toBe(false);
    expect(isProductionInstance(undefined)).toBe(false);
  });
});

describe('channel helpers', () => {
  test('labels known channels and passes through unknown', () => {
    expect(channelLabel('whatsapp-baileys')).toBe('WhatsApp (Baileys)');
    expect(channelLabel('mystery')).toBe('mystery');
  });
  test('identifies whatsapp-family channels', () => {
    expect(isWhatsApp('whatsapp-baileys')).toBe(true);
    expect(isWhatsApp('twilio-whatsapp')).toBe(true);
    expect(isWhatsApp('discord')).toBe(false);
  });
});

describe('connection state', () => {
  test('normalises varied backend strings', () => {
    expect(normalizeConnState('open')).toBe('connected');
    expect(normalizeConnState(null, true)).toBe('connected');
    expect(normalizeConnState('qr')).toBe('connecting');
    expect(normalizeConnState('closed')).toBe('disconnected');
    expect(normalizeConnState('')).toBe('unknown');
  });
  test('maps to a status dot state', () => {
    expect(connStateDot('connected')).toBe('active');
    expect(connStateDot('connecting')).toBe('away');
    expect(connStateDot('disconnected')).toBe('error');
    expect(connStateDot('unknown')).toBe('idle');
  });
});

describe('send/receive proof', () => {
  test('splits inbound and outbound from recent events', () => {
    const proof = deriveSendReceiveProof({ state: 'open', isConnected: true }, [
      { direction: 'outbound', receivedAt: '2026-07-11T10:00:00Z', status: 'delivered' },
      { direction: 'inbound', receivedAt: '2026-07-11T09:59:00Z', textContent: 'hi there' },
    ]);
    expect(proof.transport).toBe('connected');
    expect(proof.lastInboundPreview).toBe('hi there');
    expect(proof.lastOutboundState).toBe('delivered');
    expect(proof.lastInboundAt).toBeGreaterThan(0);
  });
  test('truncates long inbound previews', () => {
    const proof = deriveSendReceiveProof(undefined, [{ direction: 'inbound', textContent: 'x'.repeat(200) }]);
    expect(proof.lastInboundPreview?.endsWith('…')).toBe(true);
    expect(proof.transport).toBe('unknown');
  });
});

describe('qr payload', () => {
  test('detects image data URLs', () => {
    expect(isQrImage('data:image/png;base64,AAAA')).toBe(true);
    expect(isQrImage('2@abc,def')).toBe(false);
    expect(isQrImage(null)).toBe(false);
  });
});

describe('readSlackReturnNonce', () => {
  test('reads the nonce the Slack callback appended', () => {
    expect(readSlackReturnNonce('?slack=Abc123_-xyz')).toBe('Abc123_-xyz');
    expect(readSlackReturnNonce('slack=Abc123_-xyz')).toBe('Abc123_-xyz');
    expect(readSlackReturnNonce('?tab=events&slack=Abc123_-xyz')).toBe('Abc123_-xyz');
  });
  test('returns null for an unrelated query', () => {
    expect(readSlackReturnNonce('?tab=events')).toBeNull();
    expect(readSlackReturnNonce('?slackish=Abc123_-xyz')).toBeNull();
  });
  test('returns null for an empty search', () => {
    expect(readSlackReturnNonce('')).toBeNull();
  });
  test('rejects a value the nonce route would refuse', () => {
    expect(readSlackReturnNonce('?slack=')).toBeNull();
    expect(readSlackReturnNonce('?slack=short')).toBeNull();
    expect(readSlackReturnNonce('?slack=has%20a%20space')).toBeNull();
    expect(readSlackReturnNonce(`?slack=${'a'.repeat(129)}`)).toBeNull();
  });
});

describe('slackMissingKeysText', () => {
  test('names the single missing key', () => {
    expect(slackMissingKeysText(['server.public_url'])).toBe(
      'Slack app is not configured — missing setting: server.public_url.',
    );
  });
  test('names every missing key', () => {
    const text = slackMissingKeysText(['slack.app.client_id', 'slack.app.client_secret', 'server.public_url']);
    expect(text).toBe(
      'Slack app is not configured — missing settings: slack.app.client_id, slack.app.client_secret, server.public_url.',
    );
    expect(text).toContain('slack.app.client_secret');
  });
  test('stays readable when the API reports nothing missing', () => {
    expect(slackMissingKeysText([])).toBe('Slack app is not configured.');
  });
});

describe('minimalPatch', () => {
  const current = { enableAutoSplit: true, groupHistorySize: 50, name: 'a', discordBotToken: undefined };
  test('sends only changed, non-blank fields', () => {
    const body = minimalPatch(
      { enableAutoSplit: false, groupHistorySize: 50, name: 'a', discordBotToken: '' },
      current,
      ['enableAutoSplit', 'groupHistorySize', 'name', 'discordBotToken'],
    );
    expect(body).toEqual({ enableAutoSplit: false });
  });
  test('never sends a blank credential over a redacted secret', () => {
    const body = minimalPatch({ discordBotToken: '' }, current, ['discordBotToken']);
    expect(body).toEqual({});
  });
  test('sends a changed credential', () => {
    const body = minimalPatch({ discordBotToken: 'new-token' }, current, ['discordBotToken']);
    expect(body).toEqual({ discordBotToken: 'new-token' });
  });
});

describe('stripSlackReturnParam', () => {
  test('removes the slack parameter and nothing else', () => {
    expect(stripSlackReturnParam('?slack=Abc123_-xyz')).toBe('');
    expect(stripSlackReturnParam('?a=1&slack=Abc123_-xyz')).toBe('?a=1');
    expect(stripSlackReturnParam('?slack=Abc123_-xyz&a=1')).toBe('?a=1');
    expect(stripSlackReturnParam('?a=1&slack=Abc123_-xyz&b=2')).toBe('?a=1&b=2');
  });

  test('leaves the neighbours byte-identical, which URLSearchParams would not', () => {
    // A space stays percent-encoded, a valueless flag gains no '=', and a
    // repeated key keeps both values in order.
    expect(stripSlackReturnParam('?a=b%20c&slack=Abc123_-xyz')).toBe('?a=b%20c');
    expect(stripSlackReturnParam('?flag&slack=Abc123_-xyz')).toBe('?flag');
    expect(stripSlackReturnParam('?a=1&a=2&slack=Abc123_-xyz')).toBe('?a=1&a=2');
    expect(stripSlackReturnParam('?redirect=%2Fa%2Fb&slack=Abc123_-xyz')).toBe('?redirect=%2Fa%2Fb');
  });

  test('is a no-op when there is no slack parameter', () => {
    expect(stripSlackReturnParam('')).toBe('');
    expect(stripSlackReturnParam('?a=1')).toBe('?a=1');
    expect(stripSlackReturnParam('a=1')).toBe('?a=1');
  });

  test('does not strip a parameter that merely starts with the same letters', () => {
    expect(stripSlackReturnParam('?slackbot=1&slack=Abc123_-xyz')).toBe('?slackbot=1');
    expect(stripSlackReturnParam('?slack_team=T1')).toBe('?slack_team=T1');
  });
});
