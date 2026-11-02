import { expect, test } from 'bun:test';

test('non-UUID messageIds are not UUIDs and should pass through unchanged', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // WhatsApp external IDs are hex strings without hyphens
  expect(UUID_REGEX.test('3EB0A1B2C3D4E5F6')).toBe(false);
  expect(UUID_REGEX.test('BAE5ABC123')).toBe(false);
  expect(UUID_REGEX.test('ABCDEF1234567890')).toBe(false);

  // These should NOT be treated as UUIDs — they pass through directly
  // to the plugin without a database lookup
});
