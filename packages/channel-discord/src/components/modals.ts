/**
 * Modal component builder
 *
 * Creates modal dialogs with text input fields.
 */

import {
  ActionRowBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ContextMenuCommandInteraction,
  ModalBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ModalField, ModalOptions } from '../types';

type ModalShowableInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChatInputCommandInteraction
  | ContextMenuCommandInteraction;

/**
 * Build a text input component
 *
 * @param field - Field configuration
 * @returns TextInputBuilder instance
 */
function buildTextInput(field: ModalField): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(field.customId)
    .setLabel(field.label)
    .setStyle(field.multiline ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(field.required ?? true);

  if (field.placeholder) {
    input.setPlaceholder(field.placeholder);
  }

  if (field.minLength !== undefined) {
    input.setMinLength(field.minLength);
  }

  if (field.maxLength !== undefined) {
    input.setMaxLength(field.maxLength);
  }

  if (field.value) {
    input.setValue(field.value);
  }

  return input;
}

/**
 * Build a modal dialog
 *
 * @param options - Modal configuration
 * @returns ModalBuilder instance
 */
export function buildModal(options: ModalOptions): ModalBuilder {
  if (options.fields.length > 5) {
    throw new Error('Maximum 5 fields per modal');
  }

  const modal = new ModalBuilder().setCustomId(options.customId).setTitle(options.title);

  // Each text input must be in its own action row
  const rows = options.fields.map((field) => {
    const input = buildTextInput(field);
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  });

  modal.addComponents(rows);

  return modal;
}

/**
 * Show a modal to a user in response to an interaction
 *
 * Modals can only be shown in response to certain interactions:
 * - Button clicks
 * - Select menu selections
 * - Slash commands (before deferring)
 * - Context menu commands (before deferring)
 *
 * @param interaction - The interaction to show the modal for
 * @param options - Modal configuration
 */
export async function showModal(interaction: ModalShowableInteraction, options: ModalOptions): Promise<void> {
  const modal = buildModal(options);
  await interaction.showModal(modal);
}

/**
 * Create a simple text input modal
 *
 * @param customId - Modal custom ID
 * @param title - Modal title
 * @param fieldLabel - Label for the single text field
 * @param multiline - Whether to use a paragraph input
 * @returns ModalBuilder instance
 */
export function createSimpleModal(
  customId: string,
  title: string,
  fieldLabel: string,
  multiline = false,
): ModalBuilder {
  return buildModal({
    customId,
    title,
    fields: [
      {
        customId: 'input',
        label: fieldLabel,
        multiline,
      },
    ],
  });
}

/**
 * Create a form modal with multiple fields
 *
 * @param customId - Modal custom ID
 * @param title - Modal title
 * @param fields - Array of [label, placeholder?, required?] tuples
 * @returns ModalBuilder instance
 */
export function createFormModal(
  customId: string,
  title: string,
  fields: Array<[string, string?, boolean?]>,
): ModalBuilder {
  return buildModal({
    customId,
    title,
    fields: fields.map(([label, placeholder, required], index) => ({
      customId: `field_${index}`,
      label,
      placeholder,
      required: required ?? true,
    })),
  });
}
