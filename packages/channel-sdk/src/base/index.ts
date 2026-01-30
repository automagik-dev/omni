/**
 * Base implementations for channel plugins
 */

export { BaseChannelPlugin } from './BaseChannelPlugin';
export { ChannelRegistry, channelRegistry } from './ChannelRegistry';
export type { RegistryEntry } from './ChannelRegistry';
export { HealthChecker, aggregateHealthChecks, createHealthCheck } from './HealthChecker';
export { InstanceManager } from './InstanceManager';
