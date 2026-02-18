import { describe, expect, test } from 'bun:test';
import { type TelegramInlineButton, filterButtonsByScope } from '../senders/buttons';

describe('Button Scoping — filterButtonsByScope()', () => {
  const dmButton: TelegramInlineButton = { text: 'DM Only', data: 'dm-action', scope: 'dm' };
  const groupButton: TelegramInlineButton = { text: 'Group Only', data: 'group-action', scope: 'group' };
  const allButton: TelegramInlineButton = { text: 'Everywhere', data: 'all-action', scope: 'all' };
  const offButton: TelegramInlineButton = { text: 'Never', data: 'off-action', scope: 'off' };
  const defaultButton: TelegramInlineButton = { text: 'Default', data: 'default-action' }; // no scope = 'all'

  const allButtons = [dmButton, groupButton, allButton, offButton, defaultButton];

  test('buttons with scope dm not rendered in group messages', () => {
    const result = filterButtonsByScope(allButtons, 'group');
    const texts = result.map((b) => b.text);

    expect(texts).not.toContain('DM Only');
    expect(texts).toContain('Group Only');
    expect(texts).toContain('Everywhere');
    expect(texts).toContain('Default');
    expect(texts).not.toContain('Never');
  });

  test('buttons with scope group not rendered in DM messages', () => {
    const result = filterButtonsByScope(allButtons, 'dm');
    const texts = result.map((b) => b.text);

    expect(texts).toContain('DM Only');
    expect(texts).not.toContain('Group Only');
    expect(texts).toContain('Everywhere');
    expect(texts).toContain('Default');
    expect(texts).not.toContain('Never');
  });

  test('buttons with scope all rendered everywhere (default)', () => {
    const dmResult = filterButtonsByScope([allButton], 'dm');
    const groupResult = filterButtonsByScope([allButton], 'group');
    const supergroupResult = filterButtonsByScope([allButton], 'supergroup');

    expect(dmResult).toHaveLength(1);
    expect(groupResult).toHaveLength(1);
    expect(supergroupResult).toHaveLength(1);
  });

  test('buttons with scope off never rendered', () => {
    expect(filterButtonsByScope([offButton], 'dm')).toHaveLength(0);
    expect(filterButtonsByScope([offButton], 'group')).toHaveLength(0);
    expect(filterButtonsByScope([offButton], 'supergroup')).toHaveLength(0);
    expect(filterButtonsByScope([offButton], undefined)).toHaveLength(0);
  });

  test('default scope is all (backward compatible)', () => {
    const button: TelegramInlineButton = { text: 'No Scope', data: 'test' };
    expect(filterButtonsByScope([button], 'dm')).toHaveLength(1);
    expect(filterButtonsByScope([button], 'group')).toHaveLength(1);
  });

  test('no buttons to render returns empty array', () => {
    const result = filterButtonsByScope([offButton], 'dm');
    expect(result).toHaveLength(0);
  });

  test('handles Telegram chat type private as DM', () => {
    const result = filterButtonsByScope([dmButton], 'private');
    expect(result).toHaveLength(1);
  });

  test('handles Telegram chat type supergroup as group', () => {
    const result = filterButtonsByScope([groupButton], 'supergroup');
    expect(result).toHaveLength(1);
  });
});
