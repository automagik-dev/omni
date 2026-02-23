/**
 * Service layer for API
 *
 * Services contain business logic and data access.
 * They are injected into routes via middleware.
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { accessCache } from '../cache/cache-keys';
import { AccessService } from './access';
import { AgentRunnerService } from './agent-runner';
import { AgentService } from './agents';
import { ApiKeyService } from './api-keys';
import { AuditService } from './audit';
import { AutomationService } from './automations';
import { BatchJobService } from './batch-jobs';
import { ChatService } from './chats';
import { ConsumerOffsetService } from './consumer-offsets';
import { ConversationService } from './conversations';
import { DeadLetterService } from './dead-letters';
import { EventOpsService } from './event-ops';
import { EventService } from './events';
import { InstanceService } from './instances';
import { MessageService } from './messages';
import { PayloadStoreService } from './payload-store';
import { PersonService } from './persons';
import { ProviderService } from './providers';
import { RouteResolver } from './route-resolver';
import { RouteService } from './routes';
import { SettingsService } from './settings';
import { SyncJobService } from './sync-jobs';
import { TTSService } from './tts';
import { WebhookService } from './webhooks';

/**
 * Service container
 */
export interface Services {
  agents: AgentService;
  apiKeys: ApiKeyService;
  conversations: ConversationService;
  audit: AuditService;
  instances: InstanceService;
  persons: PersonService;
  events: EventService;
  settings: SettingsService;
  access: AccessService;
  providers: ProviderService;
  routes: RouteService;
  routeResolver: RouteResolver;
  deadLetters: DeadLetterService;
  payloadStore: PayloadStoreService;
  eventOps: EventOpsService;
  webhooks: WebhookService;
  automations: AutomationService;
  chats: ChatService;
  messages: MessageService;
  syncJobs: SyncJobService;
  batchJobs: BatchJobService;
  agentRunner: AgentRunnerService;
  tts: TTSService;
  consumerOffsets: ConsumerOffsetService;
}

/**
 * Create all services
 */
export function createServices(db: Database, eventBus: EventBus | null): Services {
  const apiKeys = new ApiKeyService(db);
  const deadLetters = new DeadLetterService(db, eventBus);
  const payloadStore = new PayloadStoreService(db);

  const settings = new SettingsService(db);
  const routeResolver = new RouteResolver(db);

  return {
    agents: new AgentService(db, eventBus),
    apiKeys,
    conversations: new ConversationService(db, eventBus),
    audit: new AuditService(db),
    instances: new InstanceService(db, eventBus),
    persons: new PersonService(db, eventBus),
    events: new EventService(db),
    settings,
    access: new AccessService(db, eventBus, accessCache),
    providers: new ProviderService(db),
    routes: new RouteService(db, routeResolver),
    routeResolver,
    deadLetters,
    payloadStore,
    eventOps: new EventOpsService(db, eventBus, deadLetters, payloadStore),
    webhooks: new WebhookService(db, eventBus),
    automations: new AutomationService(db, eventBus),
    chats: new ChatService(db, eventBus),
    messages: new MessageService(db, eventBus),
    syncJobs: new SyncJobService(db, eventBus),
    batchJobs: new BatchJobService(db, eventBus),
    agentRunner: new AgentRunnerService(db),
    tts: new TTSService(settings),
    consumerOffsets: new ConsumerOffsetService(db),
  };
}

// Re-export service classes used externally
export { AccessService } from './access';
export { AgentRunnerService } from './agent-runner';
