import { describe, expect, test } from 'bun:test';
import type { EventPayloadMap, Logger } from '@omni/core';
import { FlowResolverRegistry, buildFlowToken } from '../flows/resolver';
import { type FlowDataHandlerContext, handleFlowDataRequest } from '../handlers/flow-data';
import { generateFlowKeyPair } from '../utils/flow-crypto';

const APP_SECRET = 'test-app-secret';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

async function hmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return Array.from(sig)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signedRequest(body: string, opts: { badSignature?: boolean } = {}): Promise<Request> {
  const signature = opts.badSignature ? 'deadbeef' : await hmacHex(body, APP_SECRET);
  return new Request('http://localhost/flows/data/inst-1', {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${signature}` },
    body,
  });
}

/** Meta-side encryption (mirrors the client): wrap AES key with RSA, AES-GCM the payload. */
async function metaEncrypt(
  payload: unknown,
  publicKeyPem: string,
): Promise<{ body: string; aesRaw: Uint8Array; iv: Uint8Array }> {
  const der = Uint8Array.from(
    atob(publicKeyPem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0),
  );
  const publicKey = await crypto.subtle.importKey(
    'spki',
    der.buffer as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const aesRaw = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.importKey('raw', aesRaw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    aesKey,
    new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer,
  );
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, aesRaw.buffer as ArrayBuffer);
  return {
    body: JSON.stringify({
      encrypted_flow_data: b64(new Uint8Array(ciphertext)),
      encrypted_aes_key: b64(new Uint8Array(wrapped)),
      initial_vector: b64(iv),
    }),
    aesRaw,
    iv,
  };
}

/** Decrypt the handler's encrypted 200 body from Meta's perspective. */
async function metaDecryptResponse(responseB64: string, aesRaw: Uint8Array, iv: Uint8Array): Promise<unknown> {
  const flipped = iv.map((byte) => byte ^ 0xff);
  const aesKey = await crypto.subtle.importKey('raw', aesRaw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: flipped.buffer as ArrayBuffer },
    aesKey,
    Uint8Array.from(atob(responseB64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

interface HarnessOptions {
  registry?: FlowResolverRegistry;
  privateKeyPem?: string;
}

async function makeContext(opts: HarnessOptions = {}): Promise<{
  ctx: FlowDataHandlerContext;
  publicKeyPem: string;
  events: EventPayloadMap['flow.data_exchange'][];
}> {
  const { privateKeyPem, publicKeyPem } = await generateFlowKeyPair();
  const events: EventPayloadMap['flow.data_exchange'][] = [];
  const ctx: FlowDataHandlerContext = {
    instanceId: 'inst-1',
    channelType: 'whatsapp-business',
    privateKeyPem: opts.privateKeyPem ?? privateKeyPem,
    appSecret: APP_SECRET,
    registry: opts.registry ?? new FlowResolverRegistry(),
    logger: noopLogger,
    publishEvent: async (payload) => {
      events.push(payload);
    },
  };
  return { ctx, publicKeyPem, events };
}

describe('handleFlowDataRequest', () => {
  test('432 on bad signature', async () => {
    const { ctx } = await makeContext();
    const res = await handleFlowDataRequest(await signedRequest('{}', { badSignature: true }), ctx);
    expect(res.status).toBe(432);
  });

  test('200 plain JSON for plain-text ping', async () => {
    const { ctx } = await makeContext();
    const res = await handleFlowDataRequest(
      await signedRequest(JSON.stringify({ version: '3.0', action: 'ping' })),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: 'active' } });
  });

  test('421 on undecryptable payload (wrong keypair)', async () => {
    const { ctx } = await makeContext();
    const other = await generateFlowKeyPair();
    const { body } = await metaEncrypt({ version: '3.0', action: 'INIT', flow_token: 'omni.1.x' }, other.publicKeyPem);
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(421);
  });

  test('421 on non-encrypted garbage body', async () => {
    const { ctx } = await makeContext();
    const res = await handleFlowDataRequest(await signedRequest(JSON.stringify({ hello: 'world' })), ctx);
    expect(res.status).toBe(421);
  });

  test('427 when the payload has no flow_token', async () => {
    const { ctx, publicKeyPem } = await makeContext();
    const { body } = await metaEncrypt({ version: '3.0', action: 'INIT' }, publicKeyPem);
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(427);
  });

  test('encrypted ping gets an encrypted active response and no event', async () => {
    const { ctx, publicKeyPem, events } = await makeContext();
    const { body, aesRaw, iv } = await metaEncrypt({ version: '3.0', action: 'ping' }, publicKeyPem);
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(200);
    expect(await metaDecryptResponse(await res.text(), aesRaw, iv)).toEqual({ data: { status: 'active' } });
    expect(events).toHaveLength(0);
  });

  test('error notification is acknowledged, not resolved', async () => {
    const { ctx, publicKeyPem, events } = await makeContext();
    const { body, aesRaw, iv } = await metaEncrypt(
      {
        version: '3.0',
        action: 'data_exchange',
        flow_token: buildFlowToken('123'),
        data: { error: 'INVALID_SCREEN', error_message: 'bad screen' },
      },
      publicKeyPem,
    );
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(200);
    expect(await metaDecryptResponse(await res.text(), aesRaw, iv)).toEqual({ data: { acknowledged: true } });
    expect(events).toHaveLength(0);
  });

  test('resolves via flow-ref registry (structured token) and publishes the event', async () => {
    const registry = new FlowResolverRegistry();
    registry.register('4242', {
      resolve: (resolveCtx) => ({
        screen: 'STEP_2',
        data: { echo: resolveCtx.data?.value, action: resolveCtx.action },
      }),
    });
    const { ctx, publicKeyPem, events } = await makeContext({ registry });

    const token = buildFlowToken('4242');
    const { body, aesRaw, iv } = await metaEncrypt(
      { version: '3.0', action: 'data_exchange', screen: 'STEP_1', data: { value: 42 }, flow_token: token },
      publicKeyPem,
    );
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(200);
    expect(await metaDecryptResponse(await res.text(), aesRaw, iv)).toEqual({
      screen: 'STEP_2',
      data: { echo: 42, action: 'data_exchange' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      instanceId: 'inst-1',
      flowId: '4242',
      flowToken: token,
      action: 'data_exchange',
      screen: 'STEP_1',
      responseScreen: 'STEP_2',
    });
  });

  test('opaque token falls back to the instance default resolver', async () => {
    const registry = new FlowResolverRegistry();
    registry.registerInstanceDefault('inst-1', { resolve: () => ({ screen: 'DEFAULT' }) });
    const { ctx, publicKeyPem } = await makeContext({ registry });

    const { body, aesRaw, iv } = await metaEncrypt(
      { version: '3.0', action: 'INIT', flow_token: 'caller-supplied-opaque-token' },
      publicKeyPem,
    );
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(await metaDecryptResponse(await res.text(), aesRaw, iv)).toEqual({ screen: 'DEFAULT' });
  });

  test('no resolver → encrypted error screen (still 200, never a hang)', async () => {
    const { ctx, publicKeyPem } = await makeContext();
    const { body, aesRaw, iv } = await metaEncrypt(
      { version: '3.0', action: 'data_exchange', screen: 'S1', flow_token: buildFlowToken('999') },
      publicKeyPem,
    );
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(200);
    const decrypted = (await metaDecryptResponse(await res.text(), aesRaw, iv)) as {
      screen: string;
      data: { error_message?: string };
    };
    expect(decrypted.screen).toBe('S1');
    expect(decrypted.data.error_message).toBeTruthy();
  });

  test('throwing resolver → encrypted error screen', async () => {
    const registry = new FlowResolverRegistry();
    registry.register('boom', {
      resolve: () => {
        throw new Error('resolver exploded');
      },
    });
    const { ctx, publicKeyPem } = await makeContext({ registry });
    const { body, aesRaw, iv } = await metaEncrypt(
      { version: '3.0', action: 'data_exchange', screen: 'S1', flow_token: buildFlowToken('boom') },
      publicKeyPem,
    );
    const res = await handleFlowDataRequest(await signedRequest(body), ctx);
    expect(res.status).toBe(200);
    const decrypted = (await metaDecryptResponse(await res.text(), aesRaw, iv)) as { data: { error_message?: string } };
    expect(decrypted.data.error_message).toBeTruthy();
  });
});
