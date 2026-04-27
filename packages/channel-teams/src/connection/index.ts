/**
 * Teams connection layer — Bot Framework Connector REST + AAD OAuth2.
 *
 * The plugin owns one `BotFrameworkClient` per connected instance. Service
 * URLs come from inbound activities (Bot Framework's "trust on first use"
 * model) and are stored in the per-instance state map.
 */

export { BotFrameworkClient } from './bot-framework-client';
export type { BotActivityPayload, SendActivityResult, BotFrameworkClientOptions } from './bot-framework-client';
export { validateCredentials, TokenAcquisitionError } from './auth';
export type { TeamsAccessToken } from './auth';
