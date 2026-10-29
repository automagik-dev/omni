# @omni/connector-clickup

ClickUp connector for Omni: one connected account, one typed task-action
catalog, one webhook contract. **API only — ClickUp is not a channel, not an
`instances` row, and does not send or receive chat messages.**

## Connect

1. In ClickUp: **Settings → Apps → API Token** → generate a personal token.
2. `omni connectors create --provider clickup --name <name> --credentials-json '{"token":"..."}'`
   (or `POST /api/v2/connectors`).
3. Omni calls `GET /api/v2/team` synchronously and stores the credential sealed.
   A rejected token leaves the connector `error` with a readable, token-free
   message; fix the credential with a PATCH instead of retyping the connection.

Optional non-secret config: `teamId` (must appear in `GET /team`) and `listId`
(the default target for `create_task` / `list_tasks`).

ClickUp v2 authorizes with the raw token in `Authorization` (no `Bearer`
prefix). The token is never returned in API responses, logs, events or error
messages.

## Actions

| Key               | ClickUp API                                             |
| ----------------- | ------------------------------------------------------- |
| `create_task`     | `POST /list/{listId}/task`                              |
| `update_task`     | `PUT /task/{taskId}` (fields and status)                |
| `add_comment`     | `POST /task/{taskId}/comment`                           |
| `list_tasks`      | `GET /list/{listId}/task?archived=false&subtasks=false` |
| `list_spaces`     | `GET /team/{teamId}/space?archived=false`               |
| `list_folders`    | `GET /space/{spaceId}/folder?archived=false`            |
| `list_lists`      | `GET /space/{spaceId}/list?archived=false` (or `/folder/{folderId}/list?archived=false`) |

Actions run through `connector.call` in an automation
(`{ "type": "connector.call", "config": { "connectorId": "...", "action": "add_comment", "input": { "taskId": "{{payload.task_id}}", "comment": "Done" } } }`)
or directly through `POST /api/v2/connectors/:id/actions/:action`.

### Discovery

The three discovery actions let a caller walk spaces → folders → lists and find
the `listId` the task actions need; no id has to be obtained out of band.

- `list_spaces` takes an optional `teamId`. It resolves in this order: the
  action input, the connector's configured `teamId`, then every Workspace
  `GET /team` returns for the token. The last path is token-derived discovery:
  when a token can see several Workspaces, their spaces are returned together,
  each tagged with its `teamId` — Omni does not pick one arbitrarily.
- `list_folders` requires `spaceId`.
- `list_lists` requires `spaceId` and takes an optional `folderId`. With a
  folder it reads that folder's lists; without one it reads the space's
  folderless lists.

Every action returns the same node shape:

```json
{
  "spaces": [
    { "id": "789", "name": "Product", "teamId": "123", "archived": false },
    { "id": "790", "name": "Marketing", "teamId": "123", "archived": false }
  ]
}
```

`folders` and `lists` replace `spaces` as the collection key. Each node always
has `id`, `name` and `archived` (`archived` is `false` when ClickUp omits it),
plus the parent ids that are known: `teamId` on spaces, `spaceId` on folders and
lists, `folderId` on lists read through a folder, and `parentFolderId` on a
subfolder returned in the flat folder list.

Discovery failures use fixed, payload-free messages: `401` invalid or expired
token, `403` missing permission for that team/space/folder, `404` wrong or
nonexistent id in that scope.

## Events

`taskStatusUpdated`, `taskCreated`, `taskUpdated`, `taskDeleted`.

Create a ClickUp webhook for the events you need, point it at the event
subscription's inbound URL, and paste ClickUp's generated secret into the
subscription. ClickUp signs each delivery with HMAC-SHA256 over the raw body in
`X-Signature` (bare lowercase hex, no prefix) and retries failures; Omni dedupes
redeliveries by `history_items[0].id`, falling back to a body hash when the
provider sends no history id.

A `taskStatusUpdated` delivery looks like:

```json
{
  "event": "taskStatusUpdated",
  "webhook_id": "7fa3ec74-69a8-4530-a251-8a13730bd204",
  "task_id": "86a1b2c3",
  "history_items": [{ "id": "280076313671714080001", "date": 1780000000000, "field": "status", "before": "in progress", "after": "done" }]
}
```

The automation sees the provider fields at the top level
(`payload.task_id`, `payload.history_items`) plus the fixed envelope
(`connectorId`, `subscriptionId`, `targetAutomationId`, `provider`, `eventKey`,
`providerEventId`, `occurredAt`, `rawPayload`).

## Failure legend

- `401` — ClickUp rejected the token; reconnect with a valid one.
- `403` — the token is valid but lacks access to the team, list or task.
- `5xx` — ClickUp-side; v1 does not retry an action automatically.
