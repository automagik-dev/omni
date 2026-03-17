/**
 * Tests for @name mention resolver (GH#209)
 */

import { describe, expect, it } from 'bun:test';
import { resolveMentions } from '../utils/mention-resolver';

describe('resolveMentions', () => {
  const nameToJid = new Map([
    ['cezar', '5511999990001@s.whatsapp.net'],
    ['felipe', '5511999990002@s.whatsapp.net'],
    ['joão', '5511999990003@s.whatsapp.net'],
    ['maria silva', '5511999990004@s.whatsapp.net'],
    ['maria', '5511999990004@s.whatsapp.net'],
  ]);

  it('resolves single @name mention', () => {
    const result = resolveMentions('@cezar hello', nameToJid);
    expect(result.text).toBe('@5511999990001 hello');
    expect(result.mentions).toEqual([{ id: '5511999990001', type: 'user' }]);
  });

  it('resolves multiple @name mentions', () => {
    const result = resolveMentions('@cezar and @felipe hello', nameToJid);
    expect(result.text).toBe('@5511999990001 and @5511999990002 hello');
    expect(result.mentions).toHaveLength(2);
    expect(result.mentions[0]).toEqual({ id: '5511999990001', type: 'user' });
    expect(result.mentions[1]).toEqual({ id: '5511999990002', type: 'user' });
  });

  it('leaves unresolvable names as plain text', () => {
    const result = resolveMentions('@unknown hello', nameToJid);
    expect(result.text).toBe('@unknown hello');
    expect(result.mentions).toHaveLength(0);
  });

  it('does not match @ in email/JID format (preceded by word char)', () => {
    const result = resolveMentions('user@cezar.com', nameToJid);
    expect(result.text).toBe('user@cezar.com');
    expect(result.mentions).toHaveLength(0);
  });

  it('handles empty text', () => {
    const result = resolveMentions('', nameToJid);
    expect(result.text).toBe('');
    expect(result.mentions).toHaveLength(0);
  });

  it('handles text without mentions', () => {
    const result = resolveMentions('hello world', nameToJid);
    expect(result.text).toBe('hello world');
    expect(result.mentions).toHaveLength(0);
  });

  it('handles empty name map', () => {
    const result = resolveMentions('@cezar hello', new Map());
    expect(result.text).toBe('@cezar hello');
    expect(result.mentions).toHaveLength(0);
  });

  it('matches names case-insensitively', () => {
    const result = resolveMentions('@Cezar hello', nameToJid);
    expect(result.text).toBe('@5511999990001 hello');
    expect(result.mentions).toHaveLength(1);
  });

  it('resolves by prefix match when no exact match', () => {
    const result = resolveMentions('@cez hello', nameToJid);
    expect(result.text).toBe('@5511999990001 hello');
    expect(result.mentions).toHaveLength(1);
  });

  it('resolves @name at start of text', () => {
    const result = resolveMentions('@felipe check this', nameToJid);
    expect(result.text).toBe('@5511999990002 check this');
    expect(result.mentions).toHaveLength(1);
  });

  it('resolves @name at end of text', () => {
    const result = resolveMentions('hello @cezar', nameToJid);
    expect(result.text).toBe('hello @5511999990001');
    expect(result.mentions).toHaveLength(1);
  });

  it('resolves @name followed by punctuation', () => {
    const result = resolveMentions('hey @cezar, how are you?', nameToJid);
    // \w* stops at comma, so only "cezar" is captured
    expect(result.text).toBe('hey @5511999990001, how are you?');
    expect(result.mentions).toHaveLength(1);
  });

  it('mixes resolved and unresolved mentions', () => {
    const result = resolveMentions('@cezar and @stranger and @felipe', nameToJid);
    expect(result.text).toBe('@5511999990001 and @stranger and @5511999990002');
    expect(result.mentions).toHaveLength(2);
  });

  it('does not match @123 (name must start with letter)', () => {
    const result = resolveMentions('@123456 hello', nameToJid);
    expect(result.text).toBe('@123456 hello');
    expect(result.mentions).toHaveLength(0);
  });
});
