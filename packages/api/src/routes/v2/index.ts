/**
 * v2 API Routes
 *
 * All REST endpoints for the v2 API with OpenAPI documentation.
 */

import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { a2aRoutes } from './a2a';
import { accessRoutes } from './access';
import { routesRoutes } from './agent-routes';
import { agentStateRoutes } from './agent-state';
import { agentTasksRoutes } from './agent-tasks';
import { agentsRoutes } from './agents';
import { authRoutes } from './auth';
import { automationsRoutes } from './automations';
import { batchJobsRoutes } from './batch-jobs';
import { chatsRoutes } from './chats';
import { contextRoutes } from './context';
import { conversationsRoutes } from './conversations';
import { deadLettersRoutes } from './dead-letters';
import { eventOpsRoutes } from './event-ops';
import { eventsRoutes } from './events';
import { followUpRoutes } from './follow-up';
import { handoffsRoutes } from './handoffs';
import { instancesRoutes } from './instances';
import { journeysRoutes } from './journeys';
import { keysRoutes } from './keys';
import { logsRoutes } from './logs';
import { mediaRoutes } from './media';
import { messagesRoutes } from './messages';
import { metricsRoutes } from './metrics';
import { payloadsRoutes } from './payloads';
import { personsRoutes } from './persons';
import { processedEventsRoutes } from './processed-events';
import { providersRoutes } from './providers';
import { settingsRoutes } from './settings';
import { templatesRoutes } from './templates';
import { trustRoutes } from './trust';
import { turnsRoutes } from './turns';
import { voiceRoutes } from './voice';
import { webhooksRoutes } from './webhooks';
import { whatsappBusinessRoutes } from './whatsapp-business';
import { whatsappFlowsRoutes } from './whatsapp-flows';

export const v2Routes = new Hono<{ Variables: AppVariables }>();

// Mount all route modules
v2Routes.route('/a2a', a2aRoutes);
v2Routes.route('/agents', agentsRoutes);
v2Routes.route('/agent-state', agentStateRoutes);
v2Routes.route('/agent-tasks', agentTasksRoutes); // Agent task history (omni-m7m)
v2Routes.route('/auth', authRoutes);
v2Routes.route('/instances', instancesRoutes);
v2Routes.route('/logs', logsRoutes);
v2Routes.route('/messages', messagesRoutes); // Message CRUD + send operations
v2Routes.route('/events', eventsRoutes);
v2Routes.route('/journeys', journeysRoutes); // Journey tracing endpoints
v2Routes.route('/persons', personsRoutes);
v2Routes.route('/access', accessRoutes);
v2Routes.route('/settings', settingsRoutes);
v2Routes.route('/providers', providersRoutes);
v2Routes.route('/dead-letters', deadLettersRoutes);
v2Routes.route('/event-ops', eventOpsRoutes);
v2Routes.route('/processed-events', processedEventsRoutes); // Placeholder until #411 lands - must be before root /:id catch-all (issue #496)
v2Routes.route('/metrics', metricsRoutes);
v2Routes.route('/conversations', conversationsRoutes); // Cross-channel conversation continuity
v2Routes.route('/chats', chatsRoutes); // Unified chat model - must be before root mounts with /:id
v2Routes.route('/media', mediaRoutes); // Media file serving - must be before root mounts with /:id
v2Routes.route('/batch-jobs', batchJobsRoutes); // Batch job routes - must be before root mounts with /:id
v2Routes.route('/keys', keysRoutes); // API key management
v2Routes.route('/context', contextRoutes); // Conversation context for turn-based agents
v2Routes.route('/turns', turnsRoutes); // Turn lifecycle for turn-based agents
v2Routes.route('/trust', trustRoutes); // Genie host fingerprint trust (omni-host-fingerprint-trust wish)
v2Routes.route('/voice', voiceRoutes); // Voice session management - must be before root /:id catch-all (issue #496)
v2Routes.route('/follow-up', followUpRoutes); // Idle-chat follow-up config at /api/v2/follow-up/{agents|instances|chats}/:id (issue #404) - must be before root /:id catch-all (issue #496)
v2Routes.route('/handoffs', handoffsRoutes); // Handoff audit log at /api/v2/handoffs - must be before root /:id catch-all (issue #496)
v2Routes.route('/instances', whatsappBusinessRoutes); // WhatsApp Cloud (Meta) per-instance routes at /api/v2/instances/:id/whatsapp-business/*
v2Routes.route('/', templatesRoutes); // WhatsApp Cloud HSM templates at /api/v2/instances/:id/whatsapp-templates/* (multi-segment paths only — safe re the /:id catch-all, mounted here per the issue #496 invariant anyway)
v2Routes.route('/', whatsappFlowsRoutes); // WhatsApp Flows at /api/v2/instances/:id/whatsapp-flows/* (multi-segment paths only — same invariant as templatesRoutes above)

// ---------------------------------------------------------------------------
// ROOT MOUNTS — this block installs the '/' mounts and MUST stay last.
//
// INVARIANT: every router with a bare collection route (`get('/')`, and by
// extension any single-segment path) must be mounted ABOVE this line.
//
// `automationsRoutes` is mounted at the root so `/api/v2/automation-logs` and
// `/api/v2/automation-metrics` resolve, but it also defines `get('/:id')`,
// which at the root becomes `GET /api/v2/:id` — a single-segment catch-all over
// the whole v2 surface. Hono resolves same-path handlers in REGISTRATION ORDER,
// so any prefix router registered below it loses its bare collection path to
// the catch-all (issue #496; regressed for /handoffs, see this file's test in
// __tests__/v2-mount-order.test.ts).
// ---------------------------------------------------------------------------
v2Routes.route('/', payloadsRoutes); // Payloads routes at /api/v2/events/:id/payloads and /api/v2/payload-config
v2Routes.route('/', webhooksRoutes); // Webhook routes at /api/v2/webhooks/:source, /api/v2/webhook-sources, /api/v2/events/trigger
v2Routes.route('/automations', automationsRoutes); // Automation routes at /api/v2/automations
v2Routes.route('/', automationsRoutes); // Also mount at root for /api/v2/automation-logs, /api/v2/automation-metrics
v2Routes.route('/', routesRoutes); // Agent routing routes at /api/v2/instances/:instanceId/routes and /api/v2/routes/metrics
