/**
 * Service layer for API
 *
 * Services contain business logic and data access.
 * They are injected into routes via middleware.
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { AccessService } from './access';
import { EventService } from './events';
import { InstanceService } from './instances';
import { PersonService } from './persons';
import { ProviderService } from './providers';
import { SettingsService } from './settings';

/**
 * Service container
 */
export interface Services {
  instances: InstanceService;
  persons: PersonService;
  events: EventService;
  settings: SettingsService;
  access: AccessService;
  providers: ProviderService;
}

/**
 * Create all services
 */
export function createServices(db: Database, eventBus: EventBus | null): Services {
  return {
    instances: new InstanceService(db, eventBus),
    persons: new PersonService(db, eventBus),
    events: new EventService(db),
    settings: new SettingsService(db),
    access: new AccessService(db, eventBus),
    providers: new ProviderService(db),
  };
}

// Re-export service classes
export { InstanceService } from './instances';
export { PersonService } from './persons';
export { EventService } from './events';
export { SettingsService } from './settings';
export { AccessService } from './access';
export { ProviderService } from './providers';
