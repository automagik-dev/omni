import { describe, expect, test } from 'bun:test';
import { OmniApiError } from '../errors';

describe('OmniApiError surfaces structured server errors (#1167)', () => {
  test('Zod issue list becomes readable text', () => {
    const body = { error: { issues: [{ path: ['defaultTimeout'], message: 'Expected number, received null' }] } };
    expect(OmniApiError.from(body, 400).message).toBe('defaultTimeout: Expected number, received null');
  });

  test('{ error: { message } } keeps the message', () => {
    expect(OmniApiError.from({ error: { message: 'Name taken', code: 'CONFLICT' } }, 409).message).toBe('Name taken');
  });

  test('constructor never stringifies an object to [object Object]', () => {
    const raw = { issues: [{ path: ['name'], message: 'Required' }] } as unknown as string;
    const err = new OmniApiError(raw, 'CREATE_FAILED', undefined, 400);
    expect(err.message).toBe('name: Required');
    expect(err.message).not.toContain('[object Object]');
  });

  test('empty body falls back to status text', () => {
    expect(OmniApiError.from({}, 500).message).toBe('API error (status 500)');
  });
});
