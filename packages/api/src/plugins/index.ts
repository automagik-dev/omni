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
  type LoadPluginsOptions,
  type LoadPluginsResult,
} from './loader';

// Logger
export { createLogger } from './logger';

// Storage
export { getPluginStorage, InMemoryPluginStorage } from './storage';

// QR code handling
export {
  storeQrCode,
  getQrCode,
  clearQrCode,
  setupQrCodeListener,
  setupConnectionListener,
  setupMessageListener,
} from './qr-store';
