import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { ZenviaSalesClient } from '../sales-client';
import { ZenviaErrorBodySchema, ZenviaSalesTransferResponseSchema } from '../types';
import { ZenviaApiError, ZenviaErrorCode } from '../utils/errors';
import { jsonResponse } from './helpers';

const PROSPECT_ID = '507f191e810c19729de860ea';
const TARGET = { group: 'group-chatbot' };

function client(): ZenviaSalesClient {
  return new ZenviaSalesClient({ apiKey: 'sales-secret-key' });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

async function failureOf(response: Response): Promise<ZenviaApiError> {
  spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);
  try {
    await client().transferProspect(PROSPECT_ID, TARGET);
  } catch (err) {
    expect(err).toBeInstanceOf(ZenviaApiError);
    return err as ZenviaApiError;
  }
  throw new Error('transferProspect resolved but was expected to fail');
}

describe('Zenvia vendor response schemas', () => {
  describe('transfer response', () => {
    it('reads success only when it is a boolean and ignores every other field', () => {
      expect(ZenviaSalesTransferResponseSchema.parse({ success: false, extra: { a: 1 } }).success).toBe(false);
      expect(ZenviaSalesTransferResponseSchema.parse({ success: true }).success).toBe(true);
      expect(ZenviaSalesTransferResponseSchema.parse({}).success).toBeUndefined();
    });

    it('treats a success of the wrong type as absent instead of rejecting the body', () => {
      for (const success of ['false', 0, null, {}, []]) {
        const parsed = ZenviaSalesTransferResponseSchema.safeParse({ success });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.success).toBeUndefined();
      }
    });

    it('rejects a body that is not an object', () => {
      for (const body of [null, 'ok', 12, true, [{ success: false }]]) {
        expect(ZenviaSalesTransferResponseSchema.safeParse(body).success).toBe(false);
      }
    });
  });

  describe('error body', () => {
    it('reads code and message when they are strings and ignores every other field', () => {
      const parsed = ZenviaErrorBodySchema.parse({ code: 'E_GROUP', message: 'not allowed', extra: [1] });
      expect(parsed.code).toBe('E_GROUP');
      expect(parsed.message).toBe('not allowed');
    });

    it('treats a code or message of the wrong type as absent instead of rejecting the body', () => {
      const parsed = ZenviaErrorBodySchema.safeParse({ code: 400, message: ['not allowed'] });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.code).toBeUndefined();
      expect(parsed.success && parsed.data.message).toBeUndefined();
    });

    it('rejects a body that is not an object', () => {
      for (const body of [null, 'oops', 12, true, [{ code: 'x' }]]) {
        expect(ZenviaErrorBodySchema.safeParse(body).success).toBe(false);
      }
    });
  });
});

describe('Zenvia Sales transferProspect response', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('counts a 2xx with an empty body as transferred', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client().transferProspect(PROSPECT_ID, TARGET)).resolves.toBeUndefined();

    spyOn(globalThis, 'fetch').mockResolvedValueOnce(textResponse('', 200));
    await expect(client().transferProspect(PROSPECT_ID, TARGET)).resolves.toBeUndefined();
  });

  it('counts a 2xx with success=true and extra fields as transferred', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ success: true, prospect: { id: PROSPECT_ID }, tags: ['a'] }),
    );
    await expect(client().transferProspect(PROSPECT_ID, TARGET)).resolves.toBeUndefined();
  });

  it('counts a 2xx whose body is not JSON as transferred', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(textResponse('<html>ok</html>'));
    await expect(client().transferProspect(PROSPECT_ID, TARGET)).resolves.toBeUndefined();
  });

  it('counts a 2xx whose body has the wrong shape or a success of the wrong type as transferred', async () => {
    for (const body of [{ success: 'false' }, { success: 0 }, { success: null }, [false], 'false', 7, null]) {
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(body));
      await expect(client().transferProspect(PROSPECT_ID, TARGET)).resolves.toBeUndefined();
    }
  });

  it('refuses a 2xx that says success=false, whatever else the body carries', async () => {
    for (const body of [{ success: false }, { success: false, message: 'busy', code: 'E_BUSY', extra: [1] }]) {
      const err = await failureOf(jsonResponse(body));
      expect(err.channelCode).toBe(ZenviaErrorCode.REFUSED);
      expect(err.message).toMatch(/did not confirm the transfer/);
    }
  });
});

describe('Zenvia error responses', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('puts the vendor code and message in the error, ignoring extra fields', async () => {
    const err = await failureOf(
      jsonResponse({ code: 'E_GROUP', message: 'group not allowed', traceId: 't-1', details: [{ a: 1 }] }, 422),
    );

    expect(err.httpStatus).toBe(422);
    expect(err.vendorCode).toBe('E_GROUP');
    expect(err.channelCode).toBe(ZenviaErrorCode.INVALID_REQUEST);
    expect(err.message).toBe('HTTP 422 from Zenvia Sales transferProspect (E_GROUP): group not allowed');
  });

  it('falls back to the raw body when code and message have the wrong type', async () => {
    const raw = JSON.stringify({ code: 400, message: ['group not allowed'] });
    const err = await failureOf(textResponse(raw, 400));

    expect(err.vendorCode).toBeUndefined();
    expect(err.message).toBe(`HTTP 400 from Zenvia Sales transferProspect: ${raw}`);
  });

  it('falls back to the raw body when it is not JSON', async () => {
    const err = await failureOf(textResponse('<html>bad gateway</html>', 502));

    expect(err.vendorCode).toBeUndefined();
    expect(err.channelCode).toBe(ZenviaErrorCode.UPSTREAM_ERROR);
    expect(err.message).toBe('HTTP 502 from Zenvia Sales transferProspect: <html>bad gateway</html>');
  });

  it('cuts the raw body at 200 characters in the message', async () => {
    const err = await failureOf(textResponse('x'.repeat(500), 400));

    expect(err.message).toBe(`HTTP 400 from Zenvia Sales transferProspect: ${'x'.repeat(200)}`);
  });

  it('names only the status when the body is empty', async () => {
    const err = await failureOf(new Response(null, { status: 503 }));

    expect(err.vendorCode).toBeUndefined();
    expect(err.message).toBe('HTTP 503 from Zenvia Sales transferProspect');
  });

  it('survives a JSON body that is not an object', async () => {
    for (const body of ['null', '[1,2]', '"text"', '42']) {
      const err = await failureOf(textResponse(body, 400));
      expect(err.vendorCode).toBeUndefined();
      expect(err.message).toBe(`HTTP 400 from Zenvia Sales transferProspect: ${body}`);
    }
  });
});
