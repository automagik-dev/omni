/**
 * SSRF guard on the agent dispatcher's history-sync media download
 * (PR #770 LOW-10).
 *
 * `downloadToTempFile` fetches `mediaUrl` values that originate from channel
 * history payloads. It must refuse private/metadata targets BEFORE any
 * connection is attempted, and still work for public platform hosts.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { rm } from 'node:fs/promises';
import { __test__ } from '../agent-dispatcher';

const { downloadToTempFile } = __test__;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('downloadToTempFile — SSRF deny-list (LOW-10)', () => {
  it('refuses a cloud-metadata URL without connecting', async () => {
    const fetchMock = mock(async () => new Response('never'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await downloadToTempFile('http://169.254.169.254/latest/meta-data/', 'image/jpeg');
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('refuses an RFC1918 URL without connecting', async () => {
    const fetchMock = mock(async () => new Response('never'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await downloadToTempFile('http://10.0.0.5/media/file.ogg', 'audio/ogg');
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('still downloads from a public host (literal public IP, no DNS dependency)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = mock(async () => new Response(bytes, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await downloadToTempFile('https://93.184.216.34/media/file.bin', 'application/octet-stream');
    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (result) {
      expect(await Bun.file(result).bytes()).toEqual(bytes);
      await rm(result, { force: true });
    }
  });
});
