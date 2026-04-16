/**
 * Channel Plugin Infrastructure
 *
 * Exports everything needed for loading and managing channel plugins.
 */

// Plugin loader
export { loadChannelPlugins } from './loader';

// QR code storage
export { setupQrCodeListener } from './qr-store';

// Event listeners (connection, messages)
export {
  setupChatUnreadListener,
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
export { setupAgentResponder } from './agent-dispatcher';

// Sync worker (processes sync jobs)
export { setupHistoryPushTracker, setupSyncWorker } from './sync-worker';

// Session cleaner (clears agent sessions on trash emoji)
export { setupSessionCleaner } from './session-cleaner';

// Follow-up lifecycle hooks (arm on outbound agent message, disarm on reply/handoff/archive)
export { setupFollowUpHooks } from './follow-up-hooks';

// Instance monitoring and robustness
export { InstanceMonitor, reconnectWithPool } from './instance-monitor';
