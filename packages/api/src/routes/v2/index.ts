/**
 * v2 API Routes
 *
 * All REST endpoints for the v2 API with OpenAPI documentation.
 */

import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { accessRoutes } from './access';
import { deadLettersRoutes } from './dead-letters';
import { eventOpsRoutes } from './event-ops';
import { eventsRoutes } from './events';
import { instancesRoutes } from './instances';
import { logsRoutes } from './logs';
import { messagesRoutes } from './messages';
import { metricsRoutes } from './metrics';
import { payloadsRoutes } from './payloads';
import { personsRoutes } from './persons';
import { providersRoutes } from './providers';
import { settingsRoutes } from './settings';

export const v2Routes = new Hono<{ Variables: AppVariables }>();

// Mount all route modules
v2Routes.route('/instances', instancesRoutes);
v2Routes.route('/logs', logsRoutes);
v2Routes.route('/messages', messagesRoutes);
v2Routes.route('/events', eventsRoutes);
v2Routes.route('/persons', personsRoutes);
v2Routes.route('/access', accessRoutes);
v2Routes.route('/settings', settingsRoutes);
v2Routes.route('/providers', providersRoutes);
v2Routes.route('/dead-letters', deadLettersRoutes);
v2Routes.route('/event-ops', eventOpsRoutes);
v2Routes.route('/metrics', metricsRoutes);
v2Routes.route('/', payloadsRoutes); // Payloads routes at /api/v2/events/:id/payloads and /api/v2/payload-config
