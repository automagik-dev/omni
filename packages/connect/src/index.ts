/**
 * @omni/connect: browser sign-in for an app that binds one owner identity from an external
 * OpenID Connect issuer and keeps durable opaque sessions behind an app-owned store port.
 * Runtime claim: Bun 1.4.2 only. Private; adopters consume a reviewed packed archive.
 */
export {
  CALLBACK_PATH,
  ConnectConfigError,
  MAX_SKEW_SECONDS,
  ProviderUnavailableError,
  createOidcClient,
  readClientSecret,
  validateOidcSettings,
} from './oidc';
export type { ExchangeResult, FetchLike, OidcClient, OidcDependencies, OidcSettings, RejectReason } from './oidc';
export { CORE_LIMITS, ConnectCore, RETURN_PATH, createConnectCore, hashSecret, newSetupCapability } from './sessions';
export type { AuthResult, ConnectCoreOptions, CoreLimits } from './sessions';
export { callStore } from './store-port';
export type * from './store-port';
export { TRANSACTION_LIMITS, TransactionStore } from './transactions';
export type { PendingTransaction, TransactionLimits } from './transactions';
