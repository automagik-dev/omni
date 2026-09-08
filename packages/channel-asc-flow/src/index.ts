/**
 * ASC platform Flow Channel Plugin for Omni v2
 *
 * The conversation runs inside a flow on the ASC platform. The flow's
 * `api_rest` node calls Omni; Omni answers through the platform's REST API
 * (`/rest/v2`). See `./plugin.ts` for how this differs from `@omni/channel-asc`
 * (the API Gateway / BSP-direct model).
 */

import { AscFlowPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new AscFlowPlugin();
export default plugin;

// Named exports for flexibility
export { AscFlowPlugin, DEFAULT_ASC_FLOW_BASE_URL, normalizeBaseUrl } from './plugin';
export { ASC_FLOW_CAPABILITIES } from './capabilities';
export { AscFlowClient, codErrorOf, isPlatformOk } from './client';

// Handlers
export { handleAscFlowWebhookRequest, parseInboundTurn } from './handlers/webhook';
export type { ParsedAscFlowTurn } from './handlers/webhook';

// Utils
export { buildInteractive, foldTitle, splitBubbles } from './utils/interactive';

// Errors
export { AscFlowApiError, AscFlowErrorCode, mapHttpStatusToAscFlowError, isRetryable } from './utils/errors';
export type { AscFlowErrorCodeType } from './utils/errors';

// Types
export type { AscFlowConfig, AscFlowInboundBody, AscFlowResponse } from './types';
