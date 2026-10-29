/**
 * ClickUp connector types.
 *
 * Two boundaries live here:
 *   - the ACTION INPUT schemas (`create_task`, `update_task`, `add_comment`,
 *     `list_tasks` and the `list_spaces`/`list_folders`/`list_lists` discovery
 *     pairings), validated after template rendering and before any provider
 *     call;
 *   - the API RESPONSE schemas, validated before anything else sees provider
 *     JSON.
 *
 * ClickUp ids are numeric strings (custom ids are opt-in), so they stay strings
 * at this boundary.
 */

import { z } from 'zod';

/** ClickUp API v2 base URL. Compile-time fixed: the tenant cannot influence egress. */
export const CLICKUP_DEFAULT_BASE_URL = 'https://api.clickup.com/api/v2';

const clickUpId = z.string().min(1).max(64);

/** ClickUp accepts Unix milliseconds; callers may hand us an ISO-8601 string. */
const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'dueDate must be an ISO 8601 date string or a Unix millisecond timestamp',
});

export const CreateTaskInputSchema = z
  .object({
    /** Target list; falls back to the connector's configured default list id. */
    listId: clickUpId.optional(),
    name: z.string().min(1).max(2000),
    description: z.string().max(20000).optional(),
    assignees: z.array(z.number().int().positive()).optional(),
    dueDate: z.union([z.number().int(), isoDateString]).optional(),
  })
  .strict();

export const UpdateTaskInputSchema = z
  .object({
    taskId: clickUpId,
    name: z.string().min(1).max(2000).optional(),
    description: z.string().max(20000).optional(),
    /** Moves the task's status through `PUT /task/{id}`. */
    status: z.string().min(1).max(200).optional(),
    priority: z.number().int().nullable().optional(),
    dueDate: z.union([z.number().int(), isoDateString]).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'taskId'), {
    message: 'update_task needs at least one field to change besides taskId',
    path: ['taskId'],
  });

export const AddCommentInputSchema = z
  .object({
    taskId: clickUpId,
    comment: z.string().min(1).max(20000),
    notifyAll: z.boolean().optional(),
  })
  .strict();

export const ListTasksInputSchema = z
  .object({
    /** Target list; falls back to the connector's configured default list id. */
    listId: clickUpId.optional(),
  })
  .strict();

/**
 * Discovery inputs. `teamId` is optional because the connector config may carry
 * a default team id; with neither, `list_spaces` uses GET /team (the token's
 * own workspaces) instead of inventing one. `spaceId` is required for the
 * folder/list walks, and `folderId` switches `list_lists` from the space's
 * folderless lists to a folder's lists.
 */
export const ListSpacesInputSchema = z
  .object({
    teamId: clickUpId.optional(),
  })
  .strict();

export const ListFoldersInputSchema = z
  .object({
    spaceId: clickUpId,
  })
  .strict();

export const ListListsInputSchema = z
  .object({
    spaceId: clickUpId,
    folderId: clickUpId.optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Inbound delivery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ClickUp posts `{ event, webhook_id, task_id, history_items: [...] }`. The
 * semantic event name is body-sourced; the stable per-delivery identity is
 * `history_items[0].id` (ClickUp's per-event history id, stable across retries).
 */
export const ClickUpDeliverySchema = z
  .object({
    event: z.string().min(1),
    webhook_id: z.union([z.string(), z.number()]).optional(),
    task_id: z.string().optional(),
    history_items: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]),
            date: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type ClickUpDelivery = z.infer<typeof ClickUpDeliverySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// API response boundaries
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

/**
 * The hierarchy fields a Space, Folder and List have in common. ClickUp returns
 * `archived` only for some collections and nests the parent space/folder as an
 * object; both are normalized by the manifest before the result leaves.
 */
export const ClickUpNavItemResponseSchema = z
  .object({
    id: apiId,
    name: z.string(),
    archived: z.boolean().nullish(),
    /** Set on a subfolder returned by GET /space/{id}/folder (flat list). */
    parent_folder: z.union([z.string(), z.number()]).nullish(),
    // Metadata we do not read, accepted leniently: ClickUp sends `{}` for a
    // list with no folder, and the id can be absent there.
    space: z.object({ id: apiId.optional() }).passthrough().nullish(),
    folder: z.object({ id: apiId.optional() }).passthrough().nullish(),
  })
  .passthrough();

export const ClickUpSpacesResponseSchema = z.object({ spaces: z.array(ClickUpNavItemResponseSchema) }).passthrough();

export const ClickUpFoldersResponseSchema = z.object({ folders: z.array(ClickUpNavItemResponseSchema) }).passthrough();

export const ClickUpListsResponseSchema = z.object({ lists: z.array(ClickUpNavItemResponseSchema) }).passthrough();

export type ClickUpTeam = z.infer<typeof ClickUpTeamsResponseSchema>['teams'][number];
export type ClickUpApiTask = z.infer<typeof ClickUpTaskResponseSchema>;
export type ClickUpApiComment = z.infer<typeof ClickUpCommentResponseSchema>;
export type ClickUpApiNavItem = z.infer<typeof ClickUpNavItemResponseSchema>;

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

/**
 * One navigable node: a Space, Folder or List. The shape is identical across
 * the discovery actions; a parent field is present only when that parent is
 * known. `archived` is always a boolean (ClickUp omits it for active nodes).
 */
export interface ClickUpNavItem {
  id: string;
  name: string;
  archived: boolean;
  /** Present on `list_spaces` results. */
  teamId?: string;
  /** Present on `list_folders` and `list_lists` results. */
  spaceId?: string;
  /** Present on `list_lists` results queried through a folder. */
  folderId?: string;
  /** Present on `list_folders` results for a subfolder. */
  parentFolderId?: string;
}

export interface ClickUpSpacesResult {
  spaces: ClickUpNavItem[];
}

export interface ClickUpFoldersResult {
  folders: ClickUpNavItem[];
}

export interface ClickUpListsResult {
  lists: ClickUpNavItem[];
}

export type ClickUpActionResult =
  | ClickUpTask
  | ClickUpComment
  | ClickUpTaskList
  | ClickUpSpacesResult
  | ClickUpFoldersResult
  | ClickUpListsResult;
