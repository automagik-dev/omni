/**
 * Discord interactive components
 *
 * Provides builders for buttons, select menus, and modals.
 */

// Buttons
export {
  buildButton,
  buildButtonRow,
  buildButtonRows,
  buildButtonMessage,
  sendButtonMessage,
  updateButtons,
  disableAllButtons,
} from './buttons';

// Select Menus
export {
  buildSelectMenu,
  buildSelectMenuRow,
  buildSelectMenuMessage,
  sendSelectMenuMessage,
  updateSelectMenuOptions,
  disableSelectMenu,
} from './select-menus';

// Entity Select Menus (User, Role, Channel, Mentionable)
export {
  buildUserSelectMenu,
  buildRoleSelectMenu,
  buildChannelSelectMenu,
  buildMentionableSelectMenu,
  buildUserSelectMenuRow,
  buildRoleSelectMenuRow,
  buildChannelSelectMenuRow,
  buildMentionableSelectMenuRow,
  sendUserSelectMessage,
  sendRoleSelectMessage,
  sendChannelSelectMessage,
  sendMentionableSelectMessage,
  sendEphemeralReply,
} from './entity-selects';
export type { EntitySelectMenuOptions, ChannelSelectMenuOptions } from './entity-selects';

// Component Registry
export { ComponentRegistry, getComponentRegistry, resetComponentRegistry } from './registry';
export type { ComponentEntry, RegisterOptions, ResolveOptions, RegistryStats } from './registry';

// Components v2 Containers (feature-flagged)
export {
  buildTextDisplay,
  buildFile,
  buildFileFromArray,
  buildSection,
  buildMediaGallery,
  buildSeparator,
  buildContainer,
  buildComponentsV2Message,
  COMPONENTS_V2_FLAG,
} from './containers';
export type {
  RawComponent,
  TextDisplayOptions,
  FileOptions,
  SectionOptions,
  SectionAccessory,
  ThumbnailAccessory,
  ButtonAccessory,
  MediaGalleryOptions,
  MediaGalleryItem,
  SeparatorOptions,
  ContainerOptions,
} from './containers';

// Modals
export { buildModal, showModal, createSimpleModal, createFormModal } from './modals';
