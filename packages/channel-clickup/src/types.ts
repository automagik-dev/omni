/**
 * ClickUp channel types (issue #1413)
 *
 * ClickUp is an API-only channel: there is no chat transport, no messaging,
 * and no MCP layer. Everything the channel exposes is a small, explicit task
 * action set (`create_task`, `update_status`, `add_comment`, `list_tasks`),
 * implemented against ClickUp API v2 with a per-user personal API token.
 *
 * The action request is the boundary the API route and the automation engine
 * both validate against. Objects are `.strict()` so a typo fails loudly rather
 * than silently running a different operation.
 */

import { z } from 'zod';

/** ClickUp API v2 base URL. `custom_task_ids`/`team_id` query flags stay off. */
export const CLICKUP_DEFAULT_BASE_URL = 'https://api.clickup.com/api/v2';

/** ClickUp task/list/team ids are numeric strings (custom task ids are opt-in). */
const clickUpId = z.string().min(1).max(64);

/**
 * An ISO 8601 due date. Parsed with `Date.parse` at the boundary because
 * ClickUp takes a Unix millisecond timestamp and callers naturally hand us
 * `2026-11-01T12:00:00Z`.
 */
const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'dueDate must be an ISO 8601 date string or a Unix millisecond timestamp',
});

const createTaskRequest = z
  .object({
    operation: z.literal('create_task'),
    /** Target list; falls back to the instance's persisted default list id. */
    listId: clickUpId.optional(),
    name: z.string().min(1).max(2000),
    description: z.string().max(20000).optional(),
    assignees: z.array(z.number().int().positive()).optional(),
    dueDate: z.union([z.number().int(), isoDateString]).optional(),
  })
  .strict();

const updateStatusRequest = z
  .object({
    operation: z.literal('update_status'),
    taskId: clickUpId,
    status: z.string().min(1).max(200),
  })
  .strict();

const addCommentRequest = z
  .object({
    operation: z.literal('add_comment'),
    taskId: clickUpId,
    comment: z.string().min(1).max(20000),
    notifyAll: z.boolean().optional(),
  })
  .strict();

const listTasksRequest = z
  .object({
    operation: z.literal('list_tasks'),
    /** Target list; falls back to the instance's persisted default list id. */
    listId: clickUpId.optional(),
  })
  .strict();

/** The single action entry point's request shape. */
export const ClickUpActionRequestSchema = z.discriminatedUnion('operation', [
  createTaskRequest,
  updateStatusRequest,
  addCommentRequest,
  listTasksRequest,
]);

export type ClickUpActionRequest = z.infer<typeof ClickUpActionRequestSchema>;
export const CLICKUP_OPERATIONS = ['create_task', 'update_status', 'add_comment', 'list_tasks'] as const;
export type ClickUpOperation = (typeof CLICKUP_OPERATIONS)[number];

/**
 * What `connect()` accepts in `config.options` (and therefore what the API
 * forwards from the instance columns). Both the generic and ClickUp-prefixed
 * spellings are accepted so a caller can use either the API's `token`/`teamId`
 * convention or the persisted-column names.
 */
export const ClickUpConnectOptionsSchema = z
  .object({
    token: z.string().min(1).optional(),
    clickupApiToken: z.string().min(1).optional(),
    teamId: z.string().min(1).optional(),
    clickupTeamId: z.string().min(1).optional(),
    listId: z.string().min(1).optional(),
    clickupListId: z.string().min(1).optional(),
  })
  .passthrough();

export type ClickUpConnectOptions = z.infer<typeof ClickUpConnectOptionsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// API response boundaries (validated with Zod before anything else sees them)
// ─────────────────────────────────────────────────────────────────────────────

/** ClickUp returns ids as strings, but a number is tolerated and normalized. */
const apiId = z.union([z.string(), z.number()]).transform((value) => String(value));

export const ClickUpTeamsResponseSchema = z
  .object({
    teams: z.array(
      z
        .object({
          id: apiId,
          name: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const ClickUpTaskResponseSchema = z
  .object({
    id: apiId,
    name: z.string(),
    url: z.string().nullish(),
    // Create/update return `status: { status, color }`; list entries may carry
    // a plain string in older payloads. Both are accepted.
    status: z.union([z.string(), z.object({ status: z.string() }).passthrough()]).nullish(),
    list: z.object({ id: apiId }).passthrough().nullish(),
  })
  .passthrough();

export const ClickUpCommentResponseSchema = z
  .object({
    id: apiId,
    text: z.string().nullish(),
  })
  .passthrough();

export const ClickUpTasksResponseSchema = z
  .object({
    tasks: z.array(ClickUpTaskResponseSchema),
  })
  .passthrough();

export type ClickUpTeam = z.infer<typeof ClickUpTeamsResponseSchema>['teams'][number];
export type ClickUpApiTask = z.infer<typeof ClickUpTaskResponseSchema>;
export type ClickUpApiComment = z.infer<typeof ClickUpCommentResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Normalized results (what the API/automations see — never raw ClickUp JSON)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClickUpTask {
  id: string;
  name: string;
  url?: string;
  status?: string;
  listId: string;
}

export interface ClickUpComment {
  id: string;
  text?: string;
}

export interface ClickUpTaskList {
  tasks: ClickUpTask[];
}

export type ClickUpActionResult = ClickUpTask | ClickUpComment | ClickUpTaskList;

/**
 * Stored connection state. Kept in memory only: the persisted credential is
 * the instance row (`instances.clickup_api_token`), re-read on connect/restart.
 */
export interface ClickUpCredentials {
  token: string;
  teamId: string;
  listId?: string;
}

/**
 * Structural shape callers (the API route, the automation callback) use
 * without importing the plugin class. Everything is resolved instance-side.
 */
export interface ClickUpActionRunner {
  execute(instanceId: string, request: ClickUpActionRequest): Promise<ClickUpActionResult>;
}
