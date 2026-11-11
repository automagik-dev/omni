import { ZenviaPlugin } from './plugin';

const plugin = new ZenviaPlugin();
export default plugin;

export { ZenviaPlugin } from './plugin';

export { ZENVIA_CAPABILITIES } from './capabilities';

export { ZenviaClient, DEFAULT_ZENVIA_BASE_URL } from './client';
export type { ZenviaClientOptions } from './client';
export { ZenviaSalesClient, DEFAULT_ZENVIA_SALES_BASE_URL } from './sales-client';
export type { ZenviaSalesClientOptions, ZenviaTransferTarget } from './sales-client';

export { handleZenviaEvent, handleZenviaWebhookRequest } from './handlers/webhook';

export {
  normalizeRoutingValue,
  parseHandoffRouting,
  resolveHandoffGroup,
  zenviaHandoffRoutingSchema,
} from './handoff-routing';
export type { HandoffGroupResolution, HandoffRoutingMiss, ZenviaHandoffRouting } from './handoff-routing';

export {
  MAX_MEDIA_HOSTS,
  isAllowedMediaHost,
  parseMediaHosts,
  zenviaMediaHostSchema,
  zenviaMediaHostsSchema,
} from './media-hosts';

export {
  buildHandoffNote,
  buildHandoffRouting,
  resolveHandoffMode,
  HANDOFF_NOT_CONFIGURED_ERROR,
} from './utils/handoff';
export type { ZenviaHandoffMode } from './utils/handoff';

export { ZenviaApiError, ZenviaErrorCode, mapHttpStatusToZenviaError, isRetryable } from './utils/errors';
export type { ZenviaErrorCodeType, ZenviaApiErrorContext } from './utils/errors';

export { toZenviaPhone } from './utils/identity';

export { ZENVIA_HANDOFF_SOLUTIONS } from './types';
export type {
  ZenviaConfig,
  ZenviaConversationRouting,
  ZenviaHandoffSolution,
  ZenviaInboundMessage,
  ZenviaOutboundContent,
  ZenviaOutboundMessage,
  ZenviaSendResponse,
} from './types';
