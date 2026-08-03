/**
 * Reference resolver for validating the Flows data-exchange path end-to-end.
 *
 * Serves a two-step demo flow (screens START → CONFIRM → SUCCESS):
 *   INIT                         → START (empty data)
 *   data_exchange from START     → CONFIRM with a summary composed of the
 *                                  submitted fields (echoed back so the
 *                                  terminal screen can template them)
 *   data_exchange from CONFIRM   → SUCCESS terminating the flow; the params
 *                                  land on the nfm_reply webhook
 *
 * Wire it env-gated from the API bootstrap (META_FLOWS_DEMO_INSTANCE) as the
 * instance default — it is a smoke-test harness, not product logic. It is
 * intentionally screen-name agnostic beyond the START/CONFIRM contract.
 */

import type { FlowResolveContext, FlowResolver, FlowScreenResponse } from './resolver';

export function createDemoFlowResolver(): FlowResolver {
  return {
    resolve(ctx: FlowResolveContext): FlowScreenResponse {
      if (ctx.action === 'INIT' || ctx.action === 'BACK') {
        return { screen: 'START', data: {} };
      }

      if (ctx.screen === 'START') {
        const data = ctx.data ?? {};
        const fields = Object.entries(data)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
          .join(' · ');
        return {
          screen: 'CONFIRM',
          data: { ...data, resumo: fields || '(nada preenchido)' },
        };
      }

      // CONFIRM (or anything else) → terminate; echo everything to the webhook.
      // Meta only accepts STRING values in extension_message_response.params —
      // a boolean/number silently prevents the client from closing the flow.
      const params: Record<string, string> = { flow_token: ctx.flowToken };
      for (const [key, value] of Object.entries(ctx.data ?? {})) {
        params[key] = Array.isArray(value) ? value.join(',') : String(value);
      }
      return {
        screen: 'SUCCESS',
        data: { extension_message_response: { params } },
      };
    },
  };
}
