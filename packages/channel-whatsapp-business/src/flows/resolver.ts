/**
 * WhatsApp Flows data-exchange resolver.
 *
 * The data endpoint must answer synchronously inside Meta's timeout, so
 * resolution is an in-process registry lookup — no queue hop. Resolvers are
 * keyed by flow ref (Meta flow id or flow name), with an optional
 * per-instance default as fallback.
 *
 * flowId discovery: the decrypted payload carries NO flow id, only the
 * flow_token echoed from the send. `sendFlow` therefore emits structured
 * tokens (`omni.<flowRef>.<uuid>`) unless the caller supplied their own —
 * `parseFlowToken` recovers the ref; opaque tokens fall through to the
 * instance default resolver.
 */

export interface FlowResolveContext {
  instanceId: string;
  /** Parsed from a structured flow token; null for caller-supplied opaque tokens. */
  flowRef: string | null;
  flowToken: string;
  action: 'INIT' | 'data_exchange' | 'BACK';
  /** Screen the user submitted from (undefined on INIT). */
  screen?: string;
  /** User-submitted key-value pairs for this step. */
  data?: Record<string, unknown>;
}

/**
 * What the endpoint sends back (pre-encryption). `screen: 'SUCCESS'` with an
 * `extension_message_response` terminates the flow and routes `params` to the
 * nfm_reply webhook.
 */
export interface FlowScreenResponse {
  screen: string;
  data?: Record<string, unknown>;
}

export interface FlowResolver {
  resolve(ctx: FlowResolveContext): Promise<FlowScreenResponse> | FlowScreenResponse;
}

const FLOW_TOKEN_PREFIX = 'omni';

/** Build a structured flow token: `omni.<flowRef>.<uuid>`. */
export function buildFlowToken(flowRef: string): string {
  return `${FLOW_TOKEN_PREFIX}.${flowRef}.${crypto.randomUUID()}`;
}

/** Recover the flow ref from a structured token; null for foreign formats. */
export function parseFlowToken(flowToken: string | undefined): string | null {
  if (!flowToken) return null;
  const parts = flowToken.split('.');
  if (parts.length < 3 || parts[0] !== FLOW_TOKEN_PREFIX) return null;
  // The uuid is the last segment; the ref may itself contain dots.
  const ref = parts.slice(1, -1).join('.');
  return ref.length > 0 ? ref : null;
}

/** Registry: flow-ref resolvers + per-instance defaults. */
export class FlowResolverRegistry {
  private readonly byFlowRef = new Map<string, FlowResolver>();
  private readonly byInstance = new Map<string, FlowResolver>();

  register(flowRef: string, resolver: FlowResolver): void {
    this.byFlowRef.set(flowRef, resolver);
  }

  registerInstanceDefault(instanceId: string, resolver: FlowResolver): void {
    this.byInstance.set(instanceId, resolver);
  }

  unregister(flowRef: string): void {
    this.byFlowRef.delete(flowRef);
  }

  /** flow-ref match first, then the instance default, else null (caller error-screens). */
  lookup(ctx: Pick<FlowResolveContext, 'instanceId' | 'flowRef'>): FlowResolver | null {
    if (ctx.flowRef) {
      const byRef = this.byFlowRef.get(ctx.flowRef);
      if (byRef) return byRef;
    }
    return this.byInstance.get(ctx.instanceId) ?? null;
  }
}

/**
 * Fallback response when no resolver matches or resolution fails: an error
 * snackbar on the screen the user is on (INIT gets a bare SUCCESS-less
 * terminal error via the same shape — Meta renders `error_message` inline).
 */
export function errorScreenResponse(ctx: Pick<FlowResolveContext, 'screen'>, message: string): FlowScreenResponse {
  return {
    screen: ctx.screen ?? 'SUCCESS',
    data: { error_message: message },
  };
}
