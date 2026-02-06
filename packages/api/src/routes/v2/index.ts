/**
 * v2 API Routes
 *
 * All REST endpoints for the v2 API with OpenAPI documentation.
 */

import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { accessRoutes } from './access';
import { authRoutes } from './auth';
import { automationsRoutes } from './automations';
import { batchJobsRoutes } from './batch-jobs';
import { chatsRoutes } from './chats';
import { deadLettersRoutes } from './dead-letters';
import { eventOpsRoutes } from './event-ops';
import { eventsRoutes } from './events';
import { instancesRoutes } from './instances';
import { keysRoutes } from './keys';
import { logsRoutes } from './logs';
import { mediaRoutes } from './media';
import { messagesRoutes } from './messages';
import { metricsRoutes } from './metrics';
import { payloadsRoutes } from './payloads';
import { personsRoutes } from './persons';
import { providersRoutes } from './providers';
import { settingsRoutes } from './settings';
import { webhooksRoutes } from './webhooks';

export const v2Routes = new Hono<{ Variables: AppVariables }>();

// Mount all route modules
v2Routes.route('/auth', authRoutes);
v2Routes.route('/instances', instancesRoutes);
v2Routes.route('/logs', logsRoutes);
v2Routes.route('/messages', messagesRoutes); // Message CRUD + send operations
v2Routes.route('/events', eventsRoutes);
v2Routes.route('/persons', personsRoutes);
v2Routes.route('/access', accessRoutes);
v2Routes.route('/settings', settingsRoutes);
v2Routes.route('/providers', providersRoutes);
v2Routes.route('/dead-letters', deadLettersRoutes);
v2Routes.route('/event-ops', eventOpsRoutes);
v2Routes.route('/metrics', metricsRoutes);
v2Routes.route('/chats', chatsRoutes); // Unified chat model - must be before root mounts with /:id
v2Routes.route('/media', mediaRoutes); // Media file serving - must be before root mounts with /:id
v2Routes.route('/batch-jobs', batchJobsRoutes); // Batch job routes - must be before root mounts with /:id
v2Routes.route('/keys', keysRoutes); // API key management
v2Routes.route('/', payloadsRoutes); // Payloads routes at /api/v2/events/:id/payloads and /api/v2/payload-config
v2Routes.route('/', webhooksRoutes); // Webhook routes at /api/v2/webhooks/:source, /api/v2/webhook-sources, /api/v2/events/trigger
v2Routes.route('/automations', automationsRoutes); // Automation routes at /api/v2/automations
v2Routes.route('/', automationsRoutes); // Also mount at root for /api/v2/automation-logs, /api/v2/automation-metrics
