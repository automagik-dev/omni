/**
 * Components v2 container builders
 *
 * Implements Discord's new Components v2 layout system using raw JSON builders.
 * Gated behind `discordComponentsV2` feature flag.
 *
 * See spike-containers.md for discord.js support analysis.
 *
 * Component types:
 * - Container (type 17): Top-level wrapper with accent color and spoiler
 * - Section (type 12): Text + accessory (thumbnail or button)
 * - Separator (type 14): Divider line with spacing
 * - MediaGallery (type 13): Grid of images
 * - File (type 11): Single attachment reference
 * - TextDisplay (type 10): Rich text within containers
 */

// Discord Components v2 type IDs
const ComponentType = {
  TextDisplay: 10,
  File: 11,
  Section: 12,
  MediaGallery: 13,
  Separator: 14,
  Container: 17,
} as const;

// IS_COMPONENTS_V2 message flag
export const COMPONENTS_V2_FLAG = 1 << 15; // 32768

/**
 * Raw component JSON (Discord API format)
 */
export interface RawComponent {
  type: number;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// TextDisplay
// ─────────────────────────────────────────────────────────────

export interface TextDisplayOptions {
  /** Text content (supports markdown) */
  content: string;
}

/**
 * Build a TextDisplay component (type 10)
 *
 * Renders rich text within a container.
 */
export function buildTextDisplay(options: TextDisplayOptions): RawComponent {
  return {
    type: ComponentType.TextDisplay,
    content: options.content,
  };
}

// ─────────────────────────────────────────────────────────────
// File
// ─────────────────────────────────────────────────────────────

export interface FileOptions {
  /** Attachment URL or reference */
  file: { url: string };
  /** Whether the file is a spoiler */
  spoiler?: boolean;
}

/**
 * Build a File component (type 11)
 *
 * References a single attachment. Validates that only one file is provided.
 *
 * @throws Error if more than 1 file is provided via array overload
 */
export function buildFile(options: FileOptions): RawComponent {
  return {
    type: ComponentType.File,
    file: options.file,
    spoiler: options.spoiler ?? false,
  };
}

/**
 * Build a File component from an array of files.
 * Validates at construction time that only 1 file is provided.
 *
 * @throws Error("File component accepts maximum 1 attachment") if >1 file
 */
export function buildFileFromArray(files: Array<{ url: string }>, spoiler?: boolean): RawComponent {
  if (files.length > 1) {
    throw new Error('File component accepts maximum 1 attachment');
  }
  if (files.length === 0) {
    throw new Error('File component requires at least 1 attachment');
  }
  return buildFile({ file: files[0], spoiler });
}

// ─────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────

export interface ThumbnailAccessory {
  type: 'thumbnail';
  /** Image URL */
  url: string;
  /** Alt text for accessibility */
  description?: string;
}

export interface ButtonAccessory {
  type: 'button';
  /** Raw button component (Discord API format) */
  component: RawComponent;
}

export type SectionAccessory = ThumbnailAccessory | ButtonAccessory;

export interface SectionOptions {
  /** Text components within the section */
  components: RawComponent[];
  /** Optional accessory (thumbnail image or button) */
  accessory?: SectionAccessory;
}

/**
 * Build a Section component (type 12)
 *
 * Displays text content with an optional accessory (thumbnail or button).
 */
export function buildSection(options: SectionOptions): RawComponent {
  const section: RawComponent = {
    type: ComponentType.Section,
    components: options.components,
  };

  if (options.accessory) {
    if (options.accessory.type === 'thumbnail') {
      section.accessory = {
        type: 11, // Thumbnail accessory type in Discord API
        media: { url: options.accessory.url },
        description: options.accessory.description,
      };
    } else {
      section.accessory = options.accessory.component;
    }
  }

  return section;
}

// ─────────────────────────────────────────────────────────────
// MediaGallery
// ─────────────────────────────────────────────────────────────

export interface MediaGalleryItem {
  /** Image URL */
  url: string;
  /** Alt text */
  description?: string;
  /** Whether this item is a spoiler */
  spoiler?: boolean;
}

export interface MediaGalleryOptions {
  /** Gallery items (images) */
  items: MediaGalleryItem[];
}

/**
 * Build a MediaGallery component (type 13)
 *
 * Displays multiple images in a grid layout.
 */
export function buildMediaGallery(options: MediaGalleryOptions): RawComponent {
  return {
    type: ComponentType.MediaGallery,
    items: options.items.map((item) => ({
      media: { url: item.url },
      description: item.description,
      spoiler: item.spoiler ?? false,
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Separator
// ─────────────────────────────────────────────────────────────

export interface SeparatorOptions {
  /** Whether to add extra spacing around the divider */
  spacing?: boolean;
  /** Whether the separator is a visible divider (default: true) */
  divider?: boolean;
}

/**
 * Build a Separator component (type 14)
 *
 * Renders a divider line between components.
 */
export function buildSeparator(options?: SeparatorOptions): RawComponent {
  return {
    type: ComponentType.Separator,
    spacing: options?.spacing ?? false,
    divider: options?.divider ?? true,
  };
}

// ─────────────────────────────────────────────────────────────
// Container
// ─────────────────────────────────────────────────────────────

export interface ContainerOptions {
  /** Child components (sections, separators, media galleries, etc.) */
  components: RawComponent[];
  /** Accent color (integer, like embed color) */
  accentColor?: number;
  /** Whether the container is a spoiler */
  spoiler?: boolean;
}

/**
 * Build a Container component (type 17)
 *
 * Top-level wrapper for Components v2 layout. Supports accent colors
 * and spoiler flag.
 */
export function buildContainer(options: ContainerOptions): RawComponent {
  const container: RawComponent = {
    type: ComponentType.Container,
    components: options.components,
  };

  if (options.accentColor !== undefined) {
    container.accent_color = options.accentColor;
  }

  if (options.spoiler) {
    container.spoiler = true;
  }

  return container;
}

// ─────────────────────────────────────────────────────────────
// Message helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build a Components v2 message payload.
 *
 * Sets the IS_COMPONENTS_V2 flag and wraps components in proper format.
 * Must only be used when `discordComponentsV2` feature flag is enabled.
 */
export function buildComponentsV2Message(components: RawComponent[]): {
  components: RawComponent[];
  flags: number;
} {
  return {
    components,
    flags: COMPONENTS_V2_FLAG,
  };
}
