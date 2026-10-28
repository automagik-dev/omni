# @omni/channel-clickup

ClickUp channel for Omni (issue #1413). **API only — ClickUp is not a messaging
channel, and this plugin does not use MCP.**

## What it does

- Connects an instance with a ClickUp **personal API token** (`GET /team` on
  ClickUp API v2 validates it and resolves the team).
- Exposes four task actions through `execute(instanceId, request)`:

  | Operation       | ClickUp API                                   |
  | --------------- | --------------------------------------------- |
  | `create_task`   | `POST /list/{listId}/task`                    |
  | `update_status` | `POST /task/{taskId}`                         |
  | `add_comment`   | `POST /task/{taskId}/comment`                 |
  | `list_tasks`    | `GET /list/{listId}/task?archived=false&subtasks=false` |

- Sends **no messages** and receives none. `sendMessage()` always returns
  `{ success: false }` with an explanation; the messaging capabilities are all
  `false`. `taskCapabilities` declares the action surface (`canCreateTask`,
  `canUpdateTask`, `canComment`, `canListTasks`).

## Token setup

1. In ClickUp: **Settings → Apps → API Token** → generate a personal token.
2. Create the instance with that token. The API persists it as
   `instances.clickup_api_token` (sealed at rest like the other channel
   credentials) and forwards it to the plugin.
3. Optionally set a default **team id** and **list id**. The team id is checked
   against `GET /team`; a `create_task`/`list_tasks` without an explicit
   `listId` falls back to the default list.

ClickUp v2 authorizes with the raw token in the `Authorization` header (no
`Bearer` prefix). The token is never returned in API responses, logs, events or
error messages.

## HTTP surface

`POST /api/v2/instances/:id/clickup/actions` takes the action request directly:

```json
{ "operation": "create_task", "name": "Follow up", "listId": "901234" }
```

Automations can use the same capability set through the `clickup` action type.
