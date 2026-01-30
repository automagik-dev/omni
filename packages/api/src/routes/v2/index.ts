/**
 * v2 API Routes
 *
 * All REST endpoints for the v2 API with OpenAPI documentation.
 */

import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { accessRoutes } from './access';
import { eventsRoutes } from './events';
import { instancesRoutes } from './instances';
import { messagesRoutes } from './messages';
import { personsRoutes } from './persons';
import { providersRoutes } from './providers';
import { settingsRoutes } from './settings';

export const v2Routes = new Hono<{ Variables: AppVariables }>();

// Mount all route modules
v2Routes.route('/instances', instancesRoutes);
v2Routes.route('/messages', messagesRoutes);
v2Routes.route('/events', eventsRoutes);
v2Routes.route('/persons', personsRoutes);
v2Routes.route('/access', accessRoutes);
v2Routes.route('/settings', settingsRoutes);
v2Routes.route('/providers', providersRoutes);
