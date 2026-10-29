# ClickUp connector runbook

This is the **connector** path: Omni owns the ClickUp account credential and the
typed task action catalog. It coexists with
[`clickup-webhook-source.md`](./clickup-webhook-source.md), which is the
credential-less inbound recipe. Use the connector when you also want Omni to
create/update tasks and comments; use the webhook source when you only need the
event.

## 1. Connect

1. In ClickUp: **Settings → Apps → API Token** → generate a personal token.
2. Create the connector:

```bash
omni connectors create \
  --provider clickup \
  --name "ClickUp — Acme" \
  --token "$CLICKUP_TOKEN" \
  --config-json '{"teamId":"123","listId":"901234"}'
```

Omni calls `GET https://api.clickup.com/api/v2/team` synchronously with the raw
token in `Authorization` (ClickUp v2 uses no `Bearer` prefix). On success the
connector is `connected`, the credential is sealed, and `GET /team`'s team is
reported as the account.

- Optional `teamId` must appear in `GET /team`; otherwise the token's first team
  is used.
- Optional `listId` is the default target for `create_task` and `list_tasks`.
- An invalid token is stored as `error` with a readable, token-free message.
  Fix it with `omni connectors update <id> --token …` rather than recreating.
- A personal token acts as the person who created it. If that person leaves or
  rotates the token, reconnect — Omni does not refresh it.

## 2. Discover space, folder and list ids

If you do not already have a `listId`, the discovery actions return one:

```bash
# Every space in the configured team; with no teamId, every space in every
# Workspace the token can see (each node carries its teamId).
omni connectors invoke <connector-id> list_spaces --input-json '{}'

# Folders in a space (subfolders are returned flat with parentFolderId).
omni connectors invoke <connector-id> list_folders --input-json '{"spaceId":"789"}'

# Lists: folderless lists in a space, or the lists of one folder.
omni connectors invoke <connector-id> list_lists --input-json '{"spaceId":"789"}'
omni connectors invoke <connector-id> list_lists --input-json '{"spaceId":"789","folderId":"456"}'
```

All three return the same node shape — `id`, `name`, `archived` and the parent
ids that are known (`teamId`, `spaceId`, `folderId`, `parentFolderId`) — under
`spaces`, `folders` or `lists`. Feed the resulting `id` into `create_task` /
`list_tasks` as `listId`.

`list_spaces` resolves its team from the action input, then the connector's
configured `teamId`, then `GET /team`: with no explicit team and several
Workspaces, it returns all of their spaces rather than guessing one. A 401 means
the token is invalid or expired, 403 means it lacks permission for that scope,
and 404 means the id is wrong or does not exist there.

## 3. Make an automation in Omni

```bash
omni automations create --name "Comment on done tasks" \
  --trigger connector.event \
  --action-json '[{"type":"connector.call","config":{
    "connectorId":"<connector-id>",
    "action":"add_comment",
    "input":{"taskId":"{{payload.task_id}}","comment":"Done: {{payload.status}}"}
  }}]'
```

The trigger is always the single literal `connector.event`; the subscription
decides which delivery runs which automation.

## 4. Create the event subscription

1. Create a ClickUp webhook in ClickUp (or with ClickUp's API) for
   `taskStatusUpdated` (and any other event you need).
2. Create the subscription, pasting ClickUp's generated secret:

```bash
omni connectors subscriptions add <connector-id> \
  --event taskStatusUpdated \
  --automation <automation-id> \
  --secret "$CLICKUP_WEBHOOK_SECRET"
```

The output includes `inboundUrl`. Point the ClickUp webhook at it:

```
<public-url>/api/v2/connectors/events/<subscription-id>
```

ClickUp signs the raw body with HMAC-SHA256 in `X-Signature` (bare lowercase
hex, no prefix). The secret is sealed and never returned; rotating it is the
same PATCH/`update` and takes effect immediately, so update the ClickUp copy too.

## 5. Prove the loop

```bash
omni connectors test <connector-id> <subscription-id>
```

This goes through parse → filters → claim → publish → automation with the
signature bypassed, and journals one `connector.event` row. Watch the automation
log and ClickUp for one `POST /task/{id}/comment`.

Then let a real delivery arrive. A provider retry of the same
`history_items[0].id` is a duplicate: `200`, no second journal row, no second
run. Replaying the journaled event deliberately (event-ops) **does** run it
again.

## Pause and remove

```bash
omni connectors subscriptions pause <connector-id> <subscription-id>
omni connectors subscriptions resume <connector-id> <subscription-id>
```

A paused subscription still verifies a delivery, then acks `202 ignored` and
publishes nothing, so ClickUp is not pushed into retries. Delete the connector
to remove its subscriptions locally (FK cascade); v1 never registered a webhook
with ClickUp, so delete the ClickUp webhook yourself.

## Failure legend

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `401` on delivery | bad signature, unknown subscription or unopenable secret | confirm the ClickUp secret and the subscription id |
| `202 ignored` | the event key or `filters` did not match | check the subscription's event key/filters |
| `409 CONNECTOR_NOT_CONNECTED` on an action | status is `error` or `revoked` | revalidate the credential |
| `400 ACTION_INPUT_INVALID` | the rendered input failed the manifest schema | check the `connector.call` input/templates |
| `502 PROVIDER_REJECTED` | ClickUp rejected the action; the message is redacted | read the message; a 401/403 also revokes the connector |
| `401`/`403`/`404` on a discovery action | token invalid or expired, permission missing for that team/space/folder, or the id is wrong in that scope | the message names the scope; fix the credential or the id |
| `500` on delivery | processing failed; the claim was released | ClickUp retries; inspect `lastError` on the subscription |
