/**
 * Tests for Components v2 container builders
 */

import { describe, expect, test } from 'bun:test';
import {
  COMPONENTS_V2_FLAG,
  buildComponentsV2Message,
  buildContainer,
  buildFile,
  buildFileFromArray,
  buildMediaGallery,
  buildSection,
  buildSeparator,
  buildTextDisplay,
} from '../components/containers';

describe('Components v2 Containers', () => {
  describe('buildTextDisplay', () => {
    test('creates text display with content', () => {
      const td = buildTextDisplay({ content: 'Hello world' });
      expect(td.type).toBe(10);
      expect(td.content).toBe('Hello world');
    });

    test('supports markdown content', () => {
      const td = buildTextDisplay({ content: '**bold** and *italic*' });
      expect(td.content).toBe('**bold** and *italic*');
    });
  });

  describe('buildFile', () => {
    test('creates file component with URL', () => {
      const file = buildFile({ file: { url: 'https://example.com/doc.pdf' } });
      expect(file.type).toBe(11);
      expect(file.file).toEqual({ url: 'https://example.com/doc.pdf' });
      expect(file.spoiler).toBe(false);
    });

    test('supports spoiler flag', () => {
      const file = buildFile({ file: { url: 'https://example.com/secret.png' }, spoiler: true });
      expect(file.spoiler).toBe(true);
    });
  });

  describe('buildFileFromArray', () => {
    test('accepts single file', () => {
      const file = buildFileFromArray([{ url: 'https://example.com/file.txt' }]);
      expect(file.type).toBe(11);
      expect(file.file).toEqual({ url: 'https://example.com/file.txt' });
    });

    test('rejects >1 file at construction time', () => {
      expect(() =>
        buildFileFromArray([{ url: 'https://example.com/a.txt' }, { url: 'https://example.com/b.txt' }]),
      ).toThrow('File component accepts maximum 1 attachment');
    });

    test('rejects 0 files', () => {
      expect(() => buildFileFromArray([])).toThrow('File component requires at least 1 attachment');
    });

    test('validation happens during builder construction, NOT at send-time', () => {
      // This test verifies the error is thrown at build time
      let errorThrown = false;
      try {
        buildFileFromArray([{ url: 'a' }, { url: 'b' }]);
      } catch {
        errorThrown = true;
      }
      expect(errorThrown).toBe(true);
    });
  });

  describe('buildSection', () => {
    test('creates section with text components', () => {
      const section = buildSection({
        components: [buildTextDisplay({ content: 'Section text' })],
      });
      expect(section.type).toBe(12);
      expect(section.components).toHaveLength(1);
    });

    test('section with thumbnail accessory', () => {
      const section = buildSection({
        components: [buildTextDisplay({ content: 'With image' })],
        accessory: {
          type: 'thumbnail',
          url: 'https://example.com/thumb.png',
          description: 'A thumbnail',
        },
      });
      expect(section.type).toBe(12);
      expect(section.accessory).toBeDefined();
      expect((section.accessory as { media: { url: string } }).media.url).toBe('https://example.com/thumb.png');
    });

    test('section with button accessory', () => {
      const section = buildSection({
        components: [buildTextDisplay({ content: 'With button' })],
        accessory: {
          type: 'button',
          component: { type: 2, label: 'Click me', custom_id: 'btn-1', style: 1 },
        },
      });
      expect(section.type).toBe(12);
      expect(section.accessory).toBeDefined();
    });

    test('section without accessory', () => {
      const section = buildSection({
        components: [buildTextDisplay({ content: 'No accessory' })],
      });
      expect(section.accessory).toBeUndefined();
    });
  });

  describe('buildMediaGallery', () => {
    test('creates gallery with multiple images', () => {
      const gallery = buildMediaGallery({
        items: [
          { url: 'https://example.com/img1.png', description: 'Image 1' },
          { url: 'https://example.com/img2.png', description: 'Image 2' },
          { url: 'https://example.com/img3.png' },
        ],
      });
      expect(gallery.type).toBe(13);
      expect(gallery.items).toHaveLength(3);
    });

    test('gallery items support spoiler flag', () => {
      const gallery = buildMediaGallery({
        items: [{ url: 'https://example.com/nsfw.png', spoiler: true }],
      });
      const items = gallery.items as Array<{ spoiler: boolean }>;
      expect(items[0].spoiler).toBe(true);
    });
  });

  describe('buildSeparator', () => {
    test('creates separator with defaults', () => {
      const sep = buildSeparator();
      expect(sep.type).toBe(14);
      expect(sep.divider).toBe(true);
      expect(sep.spacing).toBe(false);
    });

    test('creates separator with spacing', () => {
      const sep = buildSeparator({ spacing: true });
      expect(sep.spacing).toBe(true);
    });

    test('creates separator without divider', () => {
      const sep = buildSeparator({ divider: false });
      expect(sep.divider).toBe(false);
    });
  });

  describe('buildContainer', () => {
    test('creates container with child components', () => {
      const container = buildContainer({
        components: [buildTextDisplay({ content: 'Hello' }), buildSeparator(), buildTextDisplay({ content: 'World' })],
      });
      expect(container.type).toBe(17);
      expect(container.components).toHaveLength(3);
    });

    test('container with accent color', () => {
      const container = buildContainer({
        components: [buildTextDisplay({ content: 'Colored' })],
        accentColor: 0x5865f2, // Discord blurple
      });
      expect(container.accent_color).toBe(0x5865f2);
    });

    test('container with spoiler', () => {
      const container = buildContainer({
        components: [buildTextDisplay({ content: 'Hidden' })],
        spoiler: true,
      });
      expect(container.spoiler).toBe(true);
    });

    test('container without accent color or spoiler', () => {
      const container = buildContainer({
        components: [buildTextDisplay({ content: 'Plain' })],
      });
      expect(container.accent_color).toBeUndefined();
      expect(container.spoiler).toBeUndefined();
    });
  });

  describe('buildComponentsV2Message', () => {
    test('sets IS_COMPONENTS_V2 flag', () => {
      const msg = buildComponentsV2Message([
        buildContainer({
          components: [buildTextDisplay({ content: 'V2 message' })],
        }),
      ]);
      expect(msg.flags).toBe(COMPONENTS_V2_FLAG);
      expect(msg.flags).toBe(32768);
      expect(msg.components).toHaveLength(1);
    });
  });

  describe('feature flag gating', () => {
    test('COMPONENTS_V2_FLAG is correct value (1 << 15)', () => {
      expect(COMPONENTS_V2_FLAG).toBe(32768);
      expect(COMPONENTS_V2_FLAG).toBe(1 << 15);
    });
  });
});
