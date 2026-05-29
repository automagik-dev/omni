import { describe, expect, it } from 'bun:test';
import { createTraceContextFromTraceId } from '../trace-context';

describe('trace-context normalization', () => {
  it('hashes legacy trace ids deterministically regardless of casing', () => {
    const upper = createTraceContextFromTraceId('Legacy-Trace-ID', 'SPAN-SEED');
    const lower = createTraceContextFromTraceId('legacy-trace-id', 'span-seed');

    expect(upper).toEqual(lower);
    expect(upper?.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(upper?.spanId).toMatch(/^[a-f0-9]{16}$/);
  });

  it('normalizes empty and all-zero values to non-zero W3C ids', () => {
    const context = createTraceContextFromTraceId('00000000000000000000000000000000', '0000000000000000');

    expect(context?.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(context?.traceId).not.toBe('00000000000000000000000000000000');
    expect(context?.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(context?.spanId).not.toBe('0000000000000000');
  });
});
