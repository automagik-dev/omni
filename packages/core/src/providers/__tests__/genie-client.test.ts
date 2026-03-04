import { describe, expect, test } from 'bun:test';
import { interpolateTemplate } from '../genie-client';
import type { TemplateVars } from '../genie-client';

describe('interpolateTemplate', () => {
  const fullVars: TemplateVars = {
    thread_id: '123',
    chat_id: 'chat-456',
    sender_id: 'user-789',
    channel: 'telegram',
    instance_id: 'inst-abc',
  };

  test('replaces single variable', () => {
    expect(interpolateTemplate('genie-{thread_id}', fullVars)).toBe('genie-123');
  });

  test('replaces multiple variables', () => {
    expect(interpolateTemplate('{channel}-{thread_id}', fullVars)).toBe('telegram-123');
  });

  test('replaces all available variables', () => {
    const template = '{channel}/{instance_id}/{chat_id}/{thread_id}/{sender_id}';
    expect(interpolateTemplate(template, fullVars)).toBe('telegram/inst-abc/chat-456/123/user-789');
  });

  test('missing variable replaced with empty string', () => {
    const vars: TemplateVars = { chat_id: 'chat-1' };
    expect(interpolateTemplate('team-{thread_id}', vars)).toBe('team-');
  });

  test('undefined variable replaced with empty string', () => {
    const vars: TemplateVars = { thread_id: undefined };
    expect(interpolateTemplate('team-{thread_id}', vars)).toBe('team-');
  });

  test('no variables in template returns string unchanged', () => {
    expect(interpolateTemplate('static-team', fullVars)).toBe('static-team');
  });

  test('empty template returns empty string', () => {
    expect(interpolateTemplate('', fullVars)).toBe('');
  });

  test('unknown variable replaced with empty string', () => {
    expect(interpolateTemplate('{unknown_var}', fullVars)).toBe('');
  });

  test('preserves text around variables', () => {
    expect(interpolateTemplate('prefix-{thread_id}-suffix', fullVars)).toBe('prefix-123-suffix');
  });

  test('handles variable at start and end', () => {
    expect(interpolateTemplate('{thread_id}', fullVars)).toBe('123');
  });

  test('handles empty vars object', () => {
    expect(interpolateTemplate('{thread_id}', {})).toBe('');
  });
});
