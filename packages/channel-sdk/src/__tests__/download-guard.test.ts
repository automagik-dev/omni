import { describe, expect, mock, test } from 'bun:test';
import { DownloadTooLargeError, createDownloadGuard } from '../download-guard';

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  };
}

function createMockResponse(contentLength: number | null): Response {
  const headers = new Headers();
  if (contentLength !== null) {
    headers.set('content-length', String(contentLength));
  }
  return new Response(null, { headers });
}

describe('createDownloadGuard', () => {
  test('defaults to 50MB max size', () => {
    const guard = createDownloadGuard();
    expect(guard.maxSizeBytes).toBe(50 * 1024 * 1024);
  });

  test('accepts custom max size', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 10_000 });
    expect(guard.maxSizeBytes).toBe(10_000);
  });
});

describe('checkSize', () => {
  test('allows sizes under the limit', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    expect(() => guard.checkSize(999, logger)).not.toThrow();
  });

  test('allows sizes at exactly the limit', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    expect(() => guard.checkSize(1000, logger)).not.toThrow();
  });

  test('throws DownloadTooLargeError for sizes over the limit', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    expect(() => guard.checkSize(1001, logger)).toThrow(DownloadTooLargeError);
  });

  test('logs WARN when download exceeds limit', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    try {
      guard.checkSize(5000, logger, { instanceId: 'inst-1', url: 'https://example.com/big' });
    } catch {
      // expected
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'download_too_large',
      expect.objectContaining({
        event: 'download_too_large',
        instanceId: 'inst-1',
        contentLength: 5000,
        maxSizeBytes: 1000,
      }),
    );
  });

  test('DownloadTooLargeError contains size info', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    try {
      guard.checkSize(5000, logger);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(DownloadTooLargeError);
      const err = e as DownloadTooLargeError;
      expect(err.contentLength).toBe(5000);
      expect(err.maxSize).toBe(1000);
    }
  });
});

describe('checkResponse', () => {
  test('allows response with small content-length', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    const response = createMockResponse(500);
    expect(() => guard.checkResponse(response, logger)).not.toThrow();
  });

  test('throws for response with content-length over limit', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    const response = createMockResponse(5000);
    expect(() => guard.checkResponse(response, logger)).toThrow(DownloadTooLargeError);
  });

  test('allows response with no content-length header (unknown size)', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    const response = createMockResponse(null);
    expect(() => guard.checkResponse(response, logger)).not.toThrow();
  });

  test('logs WARN when content-length header is absent', () => {
    const guard = createDownloadGuard({ maxSizeBytes: 1000 });
    const logger = createMockLogger();
    const response = createMockResponse(null);
    guard.checkResponse(response, logger, { instanceId: 'inst-1', url: 'https://example.com/file' });
    expect(logger.warn).toHaveBeenCalledWith(
      'download_size_unknown',
      expect.objectContaining({
        event: 'download_size_unknown',
        instanceId: 'inst-1',
        url: 'https://example.com/file',
      }),
    );
  });

  test('handles 50MB boundary correctly', () => {
    const guard = createDownloadGuard(); // default 50MB
    const logger = createMockLogger();
    const fiftyMB = 50 * 1024 * 1024;

    expect(() => guard.checkResponse(createMockResponse(fiftyMB), logger)).not.toThrow();
    expect(() => guard.checkResponse(createMockResponse(fiftyMB + 1), logger)).toThrow(DownloadTooLargeError);
  });
});
