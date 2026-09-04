/**
 * CLI `omni send --sent-by` — the authorship marker is validated at the CLI
 * boundary with the same enum the API's SentByField accepts.
 */

import { describe, expect, test } from 'bun:test';
import { __testables } from '../send';

const { sentBySchema } = __testables;

describe('sentBySchema', () => {
  test('accepts exactly the API authorship markers', () => {
    expect(sentBySchema.parse('agent')).toBe('agent');
    expect(sentBySchema.parse('user')).toBe('user');
    expect(sentBySchema.options).toEqual(['agent', 'user']);
  });

  test('rejects anything else, including case and whitespace variants', () => {
    for (const value of ['Agent', 'USER', ' user', 'bot', '']) {
      expect(sentBySchema.safeParse(value).success).toBe(false);
    }
  });
});
