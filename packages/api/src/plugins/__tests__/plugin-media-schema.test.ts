/** downloadInboundMedia is a plugin boundary — bad shapes must not reach storage. */
import { describe, expect, test } from 'bun:test';
import { pluginMediaSchema } from '../media-processor';

describe('pluginMediaSchema', () => {
  test('accepts a buffer with a mime type', () => {
    const r = pluginMediaSchema.parse({ buffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(r.mimeType).toBe('image/png');
  });

  test('accepts a missing mimeType — fallbackMimeType covers it', () => {
    expect(pluginMediaSchema.parse({ buffer: Buffer.from('x') }).mimeType).toBeUndefined();
  });

  test('rejects a non-buffer body', () => {
    expect(() => pluginMediaSchema.parse({ buffer: 'not bytes' })).toThrow();
  });

  test('rejects an empty mimeType instead of storing it as the type', () => {
    expect(() => pluginMediaSchema.parse({ buffer: Buffer.from('x'), mimeType: '' })).toThrow();
  });
});
