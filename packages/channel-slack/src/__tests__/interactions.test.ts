/**
 * Tests for Slack interactive components + slash commands
 *
 * Tests Group C: Interactive Components + Slash Commands
 */

import { describe, expect, it } from 'bun:test';

import {
  actionsBlock,
  buildModalView,
  button,
  channelsSelect,
  conversationsSelect,
  datePicker,
  dividerBlock,
  externalSelect,
  inputBlock,
  isOmniAction,
  prefixActionId,
  sectionBlock,
  staticSelect,
  timePicker,
  usersSelect,
} from '../components/blocks';
import type { CommandPayload } from '../handlers/commands';
import type { SlackInteractionPayload } from '../types';

// ─────────────────────────────────────────────────────────────
// Action ID prefixing
// ─────────────────────────────────────────────────────────────

describe('Action ID utilities', () => {
  it('prefixes plain action IDs', () => {
    expect(prefixActionId('my-button')).toBe('omni:my-button');
  });

  it('does not double-prefix', () => {
    expect(prefixActionId('omni:my-button')).toBe('omni:my-button');
  });

  it('detects omni actions', () => {
    expect(isOmniAction('omni:click')).toBe(true);
    expect(isOmniAction('other:click')).toBe(false);
    expect(isOmniAction('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Block Kit element builders
// ─────────────────────────────────────────────────────────────

describe('Block Kit elements', () => {
  it('builds a button', () => {
    const btn = button({ text: 'Click me', actionId: 'btn-1', value: 'v1', style: 'primary' });
    expect(btn.type).toBe('button');
    expect(btn.action_id).toBe('omni:btn-1');
    expect(btn.value).toBe('v1');
    expect(btn.style).toBe('primary');
    expect((btn.text as Record<string, unknown>).text).toBe('Click me');
  });

  it('builds a button without optional fields', () => {
    const btn = button({ text: 'Simple', actionId: 'btn-2' });
    expect(btn.type).toBe('button');
    expect(btn.action_id).toBe('omni:btn-2');
    expect(btn.value).toBeUndefined();
    expect(btn.style).toBeUndefined();
  });

  it('builds a static select', () => {
    const sel = staticSelect({
      actionId: 'sel-1',
      placeholder: 'Choose one',
      choices: [
        { text: 'Option A', value: 'a' },
        { text: 'Option B', value: 'b' },
      ],
    });
    expect(sel.type).toBe('static_select');
    expect(sel.action_id).toBe('omni:sel-1');
    expect((sel.options as unknown[]).length).toBe(2);
  });

  it('builds an external select', () => {
    const sel = externalSelect({ actionId: 'ext-1', placeholder: 'Search...', minQueryLength: 3 });
    expect(sel.type).toBe('external_select');
    expect(sel.action_id).toBe('omni:ext-1');
    expect(sel.min_query_length).toBe(3);
  });

  it('builds a users select', () => {
    const sel = usersSelect({ actionId: 'user-1' });
    expect(sel.type).toBe('users_select');
    expect(sel.action_id).toBe('omni:user-1');
  });

  it('builds a channels select', () => {
    const sel = channelsSelect({ actionId: 'ch-1', placeholder: 'Pick channel' });
    expect(sel.type).toBe('channels_select');
    expect(sel.action_id).toBe('omni:ch-1');
  });

  it('builds a conversations select', () => {
    const sel = conversationsSelect({ actionId: 'conv-1' });
    expect(sel.type).toBe('conversations_select');
    expect(sel.action_id).toBe('omni:conv-1');
  });

  it('builds a date picker', () => {
    const dp = datePicker({ actionId: 'date-1', initialDate: '2026-01-15' });
    expect(dp.type).toBe('datepicker');
    expect(dp.action_id).toBe('omni:date-1');
    expect(dp.initial_date).toBe('2026-01-15');
  });

  it('builds a time picker', () => {
    const tp = timePicker({ actionId: 'time-1', initialTime: '14:30' });
    expect(tp.type).toBe('timepicker');
    expect(tp.action_id).toBe('omni:time-1');
    expect(tp.initial_time).toBe('14:30');
  });
});

// ─────────────────────────────────────────────────────────────
// Block Kit layout blocks
// ─────────────────────────────────────────────────────────────

describe('Block Kit layout blocks', () => {
  it('builds an actions block', () => {
    const elements = [button({ text: 'A', actionId: 'a' }), button({ text: 'B', actionId: 'b' })];
    const block = actionsBlock(elements, 'my-block');
    expect(block.type).toBe('actions');
    expect((block.elements as unknown[]).length).toBe(2);
    expect(block.block_id).toBe('my-block');
  });

  it('builds an actions block without block_id', () => {
    const block = actionsBlock([]);
    expect(block.type).toBe('actions');
    expect(block.block_id).toBeUndefined();
  });

  it('builds a section block', () => {
    const sel = staticSelect({ actionId: 's', choices: [{ text: 'X', value: 'x' }] });
    const block = sectionBlock('Hello *world*', sel, 'sec-1');
    expect(block.type).toBe('section');
    expect((block.text as Record<string, unknown>).type).toBe('mrkdwn');
    expect((block.text as Record<string, unknown>).text).toBe('Hello *world*');
    expect(block.accessory).toBe(sel);
    expect(block.block_id).toBe('sec-1');
  });

  it('builds a section block without accessory', () => {
    const block = sectionBlock('Just text');
    expect(block.type).toBe('section');
    expect(block.accessory).toBeUndefined();
  });

  it('builds an input block', () => {
    const element = externalSelect({ actionId: 'inp-el' });
    const block = inputBlock({
      label: 'Search',
      element,
      blockId: 'inp-1',
      optional: true,
      hint: 'Type to search',
    });
    expect(block.type).toBe('input');
    expect((block.label as Record<string, unknown>).text).toBe('Search');
    expect(block.element).toBe(element);
    expect(block.block_id).toBe('inp-1');
    expect(block.optional).toBe(true);
    expect((block.hint as Record<string, unknown>).text).toBe('Type to search');
  });

  it('builds a divider block', () => {
    const block = dividerBlock();
    expect(block.type).toBe('divider');
  });
});

// ─────────────────────────────────────────────────────────────
// Modal view builder
// ─────────────────────────────────────────────────────────────

describe('Modal view builder', () => {
  it('builds a complete modal view', () => {
    const modal = buildModalView({
      callbackId: 'my-modal',
      title: 'Create Item',
      submitText: 'Save',
      cancelText: 'Dismiss',
      privateMetadata: '{"ctx":"data"}',
      blocks: [dividerBlock()],
    });
    expect(modal.type).toBe('modal');
    expect(modal.callback_id).toBe('omni:my-modal');
    expect((modal.title as Record<string, unknown>).text).toBe('Create Item');
    expect((modal.submit as Record<string, unknown>).text).toBe('Save');
    expect((modal.close as Record<string, unknown>).text).toBe('Dismiss');
    expect(modal.private_metadata).toBe('{"ctx":"data"}');
    expect((modal.blocks as unknown[]).length).toBe(1);
  });

  it('truncates title to 24 chars', () => {
    const modal = buildModalView({
      callbackId: 'modal-long',
      title: 'This is a very long modal title that exceeds the limit',
      blocks: [],
    });
    expect(((modal.title as Record<string, unknown>).text as string).length).toBeLessThanOrEqual(24);
  });

  it('defaults cancel text to Cancel', () => {
    const modal = buildModalView({
      callbackId: 'modal-default',
      title: 'Test',
      blocks: [],
    });
    expect((modal.close as Record<string, unknown>).text).toBe('Cancel');
    expect(modal.submit).toBeUndefined();
  });

  it('defaults private_metadata to empty string', () => {
    const modal = buildModalView({
      callbackId: 'modal-meta',
      title: 'Test',
      blocks: [],
    });
    expect(modal.private_metadata).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// Type interfaces validation
// ─────────────────────────────────────────────────────────────

describe('Interaction payload types', () => {
  it('SlackInteractionPayload has required fields', () => {
    const payload: SlackInteractionPayload = {
      instanceId: 'inst-1',
      type: 'button',
      actionId: 'omni:click',
      userId: 'U12345',
      value: 'clicked',
    };
    expect(payload.instanceId).toBe('inst-1');
    expect(payload.type).toBe('button');
    expect(payload.actionId).toBe('omni:click');
  });

  it('SlackInteractionPayload supports modal_submit type', () => {
    const payload: SlackInteractionPayload = {
      instanceId: 'inst-1',
      type: 'modal_submit',
      actionId: 'omni:form',
      userId: 'U12345',
      privateMetadata: '{"key":"val"}',
      rawPayload: { view_state: {} },
    };
    expect(payload.type).toBe('modal_submit');
    expect(payload.privateMetadata).toBe('{"key":"val"}');
  });

  it('CommandPayload has required fields', () => {
    const payload: CommandPayload = {
      instanceId: 'inst-1',
      command: '/omni',
      text: 'help',
      userId: 'U12345',
      channelId: 'C12345',
      triggerId: 'T12345',
      responseUrl: 'https://hooks.slack.com/commands/resp',
    };
    expect(payload.command).toBe('/omni');
    expect(payload.text).toBe('help');
    expect(payload.triggerId).toBe('T12345');
  });
});
