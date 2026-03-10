/**
 * Base implementations for channel plugins
 */

export { BaseChannelPlugin } from './BaseChannelPlugin';
export { SocialChannelPlugin } from './SocialChannelPlugin';
export type {
  CreatePostInput,
  CreatePostResult,
  GetFeedOptions,
  FeedPost,
  GetFeedResult,
  PostComment,
  GetCommentsResult,
  SocialConnection,
  GetConnectionsResult,
} from './SocialChannelPlugin';
export { ChannelRegistry, channelRegistry } from './ChannelRegistry';
export type { RegistryEntry } from './ChannelRegistry';
export { HealthChecker, aggregateHealthChecks, createHealthCheck } from './HealthChecker';
export { InstanceManager } from './InstanceManager';
