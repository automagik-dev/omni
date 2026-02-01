/**
 * Service layer for API
 *
 * Services contain business logic and data access.
 * They are injected into routes via middleware.
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { AccessService } from './access';
import { ApiKeyService } from './api-keys';
import { AutomationService } from './automations';
import { ChatService } from './chats';
import { DeadLetterService } from './dead-letters';
import { EventOpsService } from './event-ops';
import { EventService } from './events';
import { InstanceService } from './instances';
import { MessageService } from './messages';
import { PayloadStoreService } from './payload-store';
import { PersonService } from './persons';
import { ProviderService } from './providers';
import { SettingsService } from './settings';
import { SyncJobService } from './sync-jobs';
import { WebhookService } from './webhooks';

/**
 * Service container
 */
export interface Services {
  apiKeys: ApiKeyService;
  instances: InstanceService;
  persons: PersonService;
  events: EventService;
  settings: SettingsService;
  access: AccessService;
  providers: ProviderService;
  deadLetters: DeadLetterService;
  payloadStore: PayloadStoreService;
  eventOps: EventOpsService;
  webhooks: WebhookService;
  automations: AutomationService;
  chats: ChatService;
  messages: MessageService;
  syncJobs: SyncJobService;
}

/**
 * Create all services
 */
export function createServices(db: Database, eventBus: EventBus | null): Services {
  const apiKeys = new ApiKeyService(db);
  const deadLetters = new DeadLetterService(db, eventBus);
  const payloadStore = new PayloadStoreService(db);

  return {
    apiKeys,
    instances: new InstanceService(db, eventBus),
    persons: new PersonService(db, eventBus),
    events: new EventService(db),
    settings: new SettingsService(db),
    access: new AccessService(db, eventBus),
    providers: new ProviderService(db),
    deadLetters,
    payloadStore,
    eventOps: new EventOpsService(db, eventBus, deadLetters, payloadStore),
    webhooks: new WebhookService(db, eventBus),
    automations: new AutomationService(db, eventBus),
    chats: new ChatService(db, eventBus),
    messages: new MessageService(db, eventBus),
    syncJobs: new SyncJobService(db, eventBus),
  };
}

// Re-export service classes
export { ApiKeyService, type ValidatedApiKey, type CreateApiKeyOptions, type CreateApiKeyResult } from './api-keys';
export { InstanceService } from './instances';
export { PersonService } from './persons';
export { EventService } from './events';
export { SettingsService } from './settings';
export { AccessService } from './access';
export { ProviderService } from './providers';
export { DeadLetterService } from './dead-letters';
export { PayloadStoreService } from './payload-store';
export { EventOpsService } from './event-ops';
export { WebhookService } from './webhooks';
export { AutomationService } from './automations';
export { ChatService } from './chats';
export { MessageService } from './messages';
export { SyncJobService } from './sync-jobs';
