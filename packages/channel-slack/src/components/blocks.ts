const ACTION_PREFIX = 'omni:';

/**
 * Prefix an action ID with the omni namespace
 */
export function prefixActionId(actionId: string): string {
  if (actionId.startsWith(ACTION_PREFIX)) return actionId;
  return `${ACTION_PREFIX}${actionId}`;
}

/**
 * Check if an action ID belongs to Omni
 */
export function isOmniAction(actionId: string): boolean {
  return actionId.startsWith(ACTION_PREFIX);
}

/**
 * Create a button element
 */
export function button(options: {
  text: string;
  actionId: string;
  value?: string;
  style?: 'primary' | 'danger';
  url?: string;
}): Record<string, unknown> {
  const element: Record<string, unknown> = {
    type: 'button',
    text: { type: 'plain_text', text: options.text },
    action_id: prefixActionId(options.actionId),
  };
  if (options.value) element.value = options.value;
  if (options.style) element.style = options.style;
  if (options.url) element.url = options.url;
  return element;
}

/**
 * Create a static select menu
 */
export function staticSelect(options: {
  actionId: string;
  placeholder?: string;
  choices: Array<{ text: string; value: string }>;
}): Record<string, unknown> {
  return {
    type: 'static_select',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
    options: options.choices.map((choice) => ({
      text: { type: 'plain_text', text: choice.text },
      value: choice.value,
    })),
  };
}

/**
 * Create an external select menu
 */
export function externalSelect(options: {
  actionId: string;
  placeholder?: string;
  minQueryLength?: number;
}): Record<string, unknown> {
  return {
    type: 'external_select',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
    min_query_length: options.minQueryLength ?? 1,
  };
}

/**
 * Create a users select menu
 */
export function usersSelect(options: {
  actionId: string;
  placeholder?: string;
}): Record<string, unknown> {
  return {
    type: 'users_select',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
  };
}

/**
 * Create a channels select menu
 */
export function channelsSelect(options: {
  actionId: string;
  placeholder?: string;
}): Record<string, unknown> {
  return {
    type: 'channels_select',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
  };
}

/**
 * Create a conversations select menu
 */
export function conversationsSelect(options: {
  actionId: string;
  placeholder?: string;
}): Record<string, unknown> {
  return {
    type: 'conversations_select',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
  };
}

/**
 * Create a date picker
 */
export function datePicker(options: {
  actionId: string;
  placeholder?: string;
  initialDate?: string;
}): Record<string, unknown> {
  return {
    type: 'datepicker',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
    initial_date: options.initialDate,
  };
}

/**
 * Create a time picker
 */
export function timePicker(options: {
  actionId: string;
  placeholder?: string;
  initialTime?: string;
}): Record<string, unknown> {
  return {
    type: 'timepicker',
    action_id: prefixActionId(options.actionId),
    placeholder: options.placeholder ? { type: 'plain_text', text: options.placeholder } : undefined,
    initial_time: options.initialTime,
  };
}

/**
 * Create an actions block containing interactive elements
 */
export function actionsBlock(elements: Array<Record<string, unknown>>, blockId?: string): Record<string, unknown> {
  const block: Record<string, unknown> = {
    type: 'actions',
    elements,
  };
  if (blockId) block.block_id = blockId;
  return block;
}

/**
 * Create a section block with optional accessory
 */
export function sectionBlock(
  text: string,
  accessory?: Record<string, unknown>,
  blockId?: string,
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
  if (accessory) block.accessory = accessory;
  if (blockId) block.block_id = blockId;
  return block;
}

/**
 * Create an input block for modals
 */
export function inputBlock(options: {
  label: string;
  element: Record<string, unknown>;
  blockId?: string;
  optional?: boolean;
  hint?: string;
}): Record<string, unknown> {
  const block: Record<string, unknown> = {
    type: 'input',
    label: { type: 'plain_text', text: options.label },
    element: options.element,
    optional: options.optional ?? false,
  };
  if (options.blockId) block.block_id = options.blockId;
  if (options.hint) block.hint = { type: 'plain_text', text: options.hint };
  return block;
}

/**
 * Create a divider block
 */
export function dividerBlock(): Record<string, unknown> {
  return { type: 'divider' };
}

/**
 * Build a modal view payload
 */
export function buildModalView(options: {
  callbackId: string;
  title: string;
  submitText?: string;
  cancelText?: string;
  privateMetadata?: string;
  blocks: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: prefixActionId(options.callbackId),
    title: { type: 'plain_text', text: options.title.substring(0, 24) },
    submit: options.submitText ? { type: 'plain_text', text: options.submitText } : undefined,
    close: options.cancelText
      ? { type: 'plain_text', text: options.cancelText }
      : { type: 'plain_text', text: 'Cancel' },
    private_metadata: options.privateMetadata ?? '',
    blocks: options.blocks,
  };
}
