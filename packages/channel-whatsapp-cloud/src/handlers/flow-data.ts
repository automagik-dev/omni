/**
 * WhatsApp Flows data-exchange endpoint handler.
 *
 * Meta calls this for endpoint-backed flows on INIT (flow opened with
 * flow_action data_exchange), data_exchange (screen submitted), BACK
 * (refresh_on_back screens) and ping (health check). The response must be
 * synchronous — screens are resolved in-process via FlowResolverRegistry.
 *
 * Status-code contract (Meta client behavior depends on these):
 *   200 — encrypted response body (or plain JSON for plain-text pings)
 *   404 — unknown instance (bad URL)
 *   421 — cannot decrypt → client re-fetches the business public key
 *   427 — flow token rejected → client tells the user to re-open the flow
 *   432 — request signature verification failed
 */

import type { EventPayloadMap, Logger } from '@omni/core';
import type { FlowResolveContext, FlowResolverRegistry, FlowScreenResponse } from '../flows/resolver';
import { errorScreenResponse, parseFlowToken } from '../flows/resolver';
import type { DecryptedFlowRequest, EncryptedFlowRequestBody } from '../utils/flow-crypto';
import { FlowDecryptError, decryptFlowRequest, encryptFlowResponse, importFlowPrivateKey } from '../utils/flow-crypto';
import { verifyMetaSignature } from '../utils/signature';

/** Resolver time budget — Meta aborts slow endpoints, so never exceed this. */
const RESOLVE_TIMEOUT_MS = 8_000;

export interface FlowDataHandlerContext {
  instanceId: string;
  channelType: string;
  /** Unsealed PKCS#8 PEM. The caller (API route) owns unsealing. */
  privateKeyPem: string;
  appSecret: string;
  registry: FlowResolverRegistry;
  logger: Logger;
  /** Observability hook — fired after the response is resolved (never for ping). */
  publishEvent: (payload: EventPayloadMap['flow.data_exchange']) => Promise<unknown>;
}

/** Either an early HTTP response (ping/errors) or the decrypted request to resolve. */
type IntakeResult = { response: Response } | { decrypted: DecryptedFlowRequest };

function isEncryptedBody(
  parsed: Record<string, unknown>,
): parsed is Record<string, unknown> & EncryptedFlowRequestBody {
  return (
    typeof parsed.encrypted_flow_data === 'string' &&
    typeof parsed.encrypted_aes_key === 'string' &&
    typeof parsed.initial_vector === 'string'
  );
}

/** Signature check, plain-ping short-circuit, and decryption. */
async function intake(request: Request, ctx: FlowDataHandlerContext): Promise<IntakeResult> {
  const rawBody = await request.text();

  const signature = request.headers.get('x-hub-signature-256');
  if (!ctx.appSecret || !signature || !(await verifyMetaSignature(rawBody, signature, ctx.appSecret))) {
    ctx.logger.warn('[whatsapp-cloud] flow data request failed signature verification', {
      instanceId: ctx.instanceId,
      hasSignature: Boolean(signature),
    });
    return { response: new Response(null, { status: 432 }) };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { response: new Response(null, { status: 421 }) };
  }

  // Plain-text health check (docs describe unencrypted pings; be liberal —
  // encrypted pings take the normal decrypt path below).
  if (parsed.action === 'ping') {
    return { response: Response.json({ data: { status: 'active' } }) };
  }

  if (!isEncryptedBody(parsed)) {
    return { response: new Response(null, { status: 421 }) };
  }

  try {
    const privateKey = await importFlowPrivateKey(ctx.privateKeyPem);
    return { decrypted: await decryptFlowRequest(parsed, privateKey) };
  } catch (err) {
    ctx.logger.warn('[whatsapp-cloud] flow data decrypt failed — responding 421', {
      instanceId: ctx.instanceId,
      error: err instanceof FlowDecryptError ? err.message : String(err),
    });
    return { response: new Response(null, { status: 421 }) };
  }
}

/** Registry lookup + resolution under the timeout budget; always yields a screen. */
async function resolveScreen(ctx: FlowDataHandlerContext, resolveCtx: FlowResolveContext): Promise<FlowScreenResponse> {
  const resolver = ctx.registry.lookup(resolveCtx);
  if (!resolver) {
    ctx.logger.warn('[whatsapp-cloud] no flow resolver registered — responding with error screen', {
      instanceId: ctx.instanceId,
      flowRef: resolveCtx.flowRef,
    });
    return errorScreenResponse(resolveCtx, 'This flow is not available right now. Please try again later.');
  }

  try {
    return await Promise.race([
      Promise.resolve(resolver.resolve(resolveCtx)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`flow resolver timed out after ${RESOLVE_TIMEOUT_MS}ms`)),
          RESOLVE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    ctx.logger.error('[whatsapp-cloud] flow resolver failed', {
      instanceId: ctx.instanceId,
      flowRef: resolveCtx.flowRef,
      action: resolveCtx.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorScreenResponse(resolveCtx, 'Something went wrong. Please try again.');
  }
}

async function publishExchangeEvent(
  ctx: FlowDataHandlerContext,
  resolveCtx: FlowResolveContext,
  responseScreen: string,
  durationMs: number,
): Promise<void> {
  try {
    await ctx.publishEvent({
      instanceId: ctx.instanceId,
      channelType: ctx.channelType as EventPayloadMap['flow.data_exchange']['channelType'],
      flowId: resolveCtx.flowRef,
      flowToken: resolveCtx.flowToken,
      action: resolveCtx.action,
      screen: resolveCtx.screen,
      data: resolveCtx.data,
      responseScreen,
      durationMs,
    });
  } catch (err) {
    // Observability must never break the synchronous response.
    ctx.logger.warn('[whatsapp-cloud] flow.data_exchange event publish failed', {
      instanceId: ctx.instanceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleFlowDataRequest(request: Request, ctx: FlowDataHandlerContext): Promise<Response> {
  const authenticated = await intake(request, ctx);
  if ('response' in authenticated) return authenticated.response;

  const { payload, aesKey, iv } = authenticated.decrypted;
  const respond = async (body: unknown): Promise<Response> =>
    new Response(await encryptFlowResponse(body, aesKey, iv), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });

  if (payload.action === 'ping') {
    return respond({ data: { status: 'active' } });
  }

  // Async error notification from the client (e.g. we returned an invalid
  // screen earlier) — acknowledge, don't resolve.
  const dataBag = (payload.data ?? {}) as Record<string, unknown>;
  if (dataBag.error != null || dataBag.error_message != null) {
    ctx.logger.warn('[whatsapp-cloud] flow client error notification', {
      instanceId: ctx.instanceId,
      flowToken: payload.flow_token,
      error: dataBag.error,
      errorMessage: dataBag.error_message,
    });
    return respond({ data: { acknowledged: true } });
  }

  if (!payload.flow_token) {
    // Without a token there is nothing to correlate or resolve against.
    return new Response(null, { status: 427 });
  }

  const resolveCtx: FlowResolveContext = {
    instanceId: ctx.instanceId,
    flowRef: parseFlowToken(payload.flow_token),
    flowToken: payload.flow_token,
    action: payload.action,
    screen: payload.screen,
    data: payload.data,
  };

  const startedAt = performance.now();
  const screenResponse = await resolveScreen(ctx, resolveCtx);
  await publishExchangeEvent(ctx, resolveCtx, screenResponse.screen, Math.round(performance.now() - startedAt));

  return respond(screenResponse);
}
