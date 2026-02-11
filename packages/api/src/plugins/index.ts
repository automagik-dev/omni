/**
 * Channel Plugin Infrastructure
 *
 * Exports everything needed for loading and managing channel plugins.
 */

// Context creation
export { createPluginContext, type CreatePluginContextOptions } from './context';

// Plugin loader
export {
  loadChannelPlugins,
  getPlugin,
  getAllPlugins,
  autoReconnectInstances,
  type LoadPluginsOptions,
  type LoadPluginsResult,
} from './loader';

// Logger
export { createLogger } from './logger';

// Storage
export { getPluginStorage, setStorageDatabase, DatabasePluginStorage, InMemoryPluginStorage } from './storage';

// QR code storage
export { storeQrCode, getQrCode, clearQrCode, setupQrCodeListener } from './qr-store';

// Event listeners (connection, messages)
export {
  setupConnectionListener,
  setupContactNamesListener,
  setupLidMappingListener,
  setupMessageListener,
} from './event-listeners';

// Event persistence (writes events to omni_events table)
export { setupEventPersistence } from './event-persistence';

// Message persistence (writes to unified chats/messages tables)
export { setupMessagePersistence } from './message-persistence';

// Media processor (transcribes/describes media content)
export { setupMediaProcessor } from './media-processor';

// Agent dispatcher (evolved from agent-responder — multi-event, multi-provider)
export { setupAgentDispatcher, setupAgentResponder, type DispatcherCleanup } from './agent-dispatcher';

// Sync worker (processes sync jobs)
export { setupSyncWorker } from './sync-worker';

// Session cleaner (clears agent sessions on trash emoji)
export { setupSessionCleaner } from './session-cleaner';

// Instance monitoring and robustness
export { InstanceMonitor, reconnectWithPool, type MonitorConfig } from './instance-monitor';
