# Slack Channel

> Slack bot integration via Bolt.js (Socket Mode or HTTP), with the Agent
> messaging experience (`agent_view` + Agent Sessions API), native streaming,
> reactions, pins, slash commands, and an optional user-token mode.

## One-click setup (OAuth)

The fastest way onto Slack. One Slack app serves the whole deployment: the
**operator registers it once**, and after that **every member connects
themselves**, as often as they like — a re-connect is a re-authorization, not
a new app.

| Who | Step | How often |
|---|---|---|
| Operator | `omni slack app setup` | **Once per deployment** — register the deployment's Slack app |
| Member | `omni slack connect` | **Every time** — once per person, and again whenever they re-authorize |

Members have two equivalent paths: `omni slack connect` from a terminal, or the
dashboard's **Connect Slack** button on the Instances page.

`omni slack app status` reports whether the app is configured, which settings
are still missing, and the redirect and manifest links.

### The manifest link (operator, once)

`omni slack app setup` reads `GET /api/v2/slack/app` and prints a
`manifestUrl`. The API builds that link itself: it takes the callback
**redirect URL** (`server.public_url` + `/api/v2/slack/oauth/callback`),
generates the app manifest around it — every bot scope, every event
subscription, and the **user scopes** the personal (`xoxp`) mode needs — and
returns it URL-encoded as an
`https://api.slack.com/apps?new_app=1&manifest_json=…` link. The operator
opens that link and Slack offers to create the app with the manifest already
filled in; nothing is pasted by hand. Setup then collects the app's client id,
client secret, signing secret and app-level token and writes them to settings
(the three secrets are read from a pipe or an interactive prompt, never from a
command-line flag).

> **The redirect URL must be HTTPS**, and it must appear in the app's
> `oauth_config.redirect_urls` — Slack refuses the exchange otherwise, which
> is exactly why the manifest link carries it. **A locally running API
> therefore needs an HTTPS tunnel**: point `server.public_url` at the tunnel's
> public `https://…` origin (not `http://localhost:…`) before running setup,
> and re-run setup if that origin changes.

### Connecting a member (every time)

`omni slack connect` calls `POST /api/v2/slack/oauth/start`, opens the
returned Slack authorize URL, and waits for the callback; the dashboard's
**Connect Slack** button does the same thing and returns the person to the page
they started from. The button sends that page's own address as the return
address, so **the dashboard must be served from the `server.public_url`
origin** — from anywhere else the API refuses the return address and the page
shows that error instead of starting the install. The
default mode is `user` — the member's own `xoxp` token, so the instance acts
as them — and `--mode bot` installs the workspace bot instead. The instance is
created (or re-authorized, if that person already installed) and connected for
you; no token is ever shown, pasted, or written down.

The pending install lives in the API process that started it, for five minutes,
and is consumed the first time the callback reads it. So the API must run as a
single process, or route `/api/v2/slack/oauth/*` with sticky sessions: a
callback that lands on a process which never issued that install is refused as
an unknown install — nothing unsafe happens, the person simply has to click
**Connect Slack** again.

Several members of one workspace share a single Bolt receiver and a single
app-level token. Each event is delivered only to the instances Slack
authorized it for, so one member's DMs never reach another member's instance.

#### Already connected? Re-authorize once for inbound files

User mode now requests the `files:read` user scope, because an inbound file is
downloaded from `files.slack.com` with the **user** token when the instance runs
in `authMode: 'user'` — the workspace bot need not be a member of the channel a
file was shared in, and answers that download with a `403`.

A token minted before this change does not carry the new scope. **Every member
who connected earlier must run `omni slack connect` once more** (or press
**Connect Slack** again) to re-authorize; the re-connect swaps their `xoxp`
token for one that includes `files:read`. Until they do, their instance keeps
receiving the message but the attachment download keeps failing with `403`.
Nothing else about the instance changes, and bot-mode instances are unaffected
— the bot token already had `files:read`.

### When access is revoked

Slack tells Omni about revocation, and the blast radius depends on which event
arrives:

| Slack event | What Omni disconnects |
|---|---|
| `tokens_revoked` | **Only the one instance** whose token was revoked (the member who revoked it, or the bot if it was the bot token), with reason `token_revoked`. Every other member of that workspace stays connected. |
| `app_uninstalled` | **Every instance of that workspace** — the app itself is gone, so no token of it is valid any more. |

### `SLACK_APP_TOKEN_IN_USE`, and what it does *not* mean

Sharing one app-level token across instances is the normal case now, so the
old "one app token, one instance" refusal has been narrowed:

- **Two (or more) user-mode installs on one app token are accepted.** That is
  the whole point of the one-click flow — every member of a workspace behind
  the same deployment app.
- **Only a second *bot-mode* install for the same workspace is refused**, with
  `409 SLACK_APP_TOKEN_IN_USE`. A workspace has exactly one bot identity, so
  two bot-mode instances would answer as the same bot and handle every event
  twice.
- That refusal is overridable: pass `force: true` (`--force`) to
  `POST /api/v2/instances/:id/connect` when the second install is deliberately
  **replacing** the first — a reinstalled bot token under a new instance id.

Without `force` the connect is refused twice over, and the API layer answers
first:

1. `409 SLACK_APP_TOKEN_IN_USE` — the route's own check
   (`findSlackBotModeConflict`) runs before the plugin is reached, so this is
   the code a caller actually sees. It is what `POST /connect` returns.
2. `SLACK_BOT_INSTANCE_EXISTS` — the Slack receiver's guard, the second layer
   behind it. It is reachable only when the route's check does not fire (for
   example an attachment the route's active-instance scan cannot see).

The manual, pasted-token path below still works and is still supported — use
it when you maintain the Slack app by hand, run without a public HTTPS URL, or
want an instance whose tokens you supply yourself.

## Agent messaging experience (#914)

Slack apps built as AI agents declare `agent_view` in their manifest. The
older `assistant_view` experience is **deprecated and will be removed in
February 2027**; new Slack apps can only use `agent_view`, and the switch from
`assistant_view` to `agent_view` is **one-way per app**. Omni targets
`agent_view`:

- `buildSlackManifest()` emits `features.agent_view` (with `agent_description`
  and optional `suggested_prompts`) — see below for generating a manifest.
- Working status uses `agents.sessions.setStatus` (`processing` while the
  agent runs, `active` when it finishes). Workspaces where the Agent Sessions
  API is not yet available fall back automatically to the deprecated
  `assistant.threads.setStatus`, which keeps working through Slack's
  compatibility bridge until February 2027.
- Omni subscribes to `agent_session_stopped`. Subscribing is what makes Slack
  show the **native stop button** while a session is `processing`; when a user
  presses it, Omni aborts the in-flight provider run (no more paying for a
  long `claude-code` run nobody wants), clears the session status, and — per
  Slack's halt-and-keep stop semantics — **keeps** whatever partial reply was
  already streamed instead of deleting it.

> **Important:** status and the stop button are **thread-scoped**. A
> channel-level mention that has not opened a thread has no status surface;
> Omni logs a `no_active_thread` debug line when it skips status for this
> reason.

## Prerequisites

1. A Slack workspace where you can install apps.
2. A **Slack app** created at <https://api.slack.com/apps> — use
   **"From an app manifest"** with the manifest generated below.
3. For Socket Mode (default): an **app-level token** (`xapp-...`) with
   `connections:write`.
4. A **bot token** (`xoxb-...`) issued on install.
5. Optional: a **user token** (`xoxp-...`) if you want user-token mode —
   required for message search (see below).

## Setup

### 1. Generate the app manifest

`buildSlackManifest()` (exported from `@omni/channel-slack`) produces a
manifest with every scope and event subscription the plugin needs, including
the Agent messaging experience:

```typescript
import { buildSlackManifest } from '@omni/channel-slack';

const manifest = buildSlackManifest({
  appName: 'My Omni Bot',
  description: 'Omni-powered agent',
  agentDescription: 'Answers questions and runs long tasks in threads', // ≤300 chars
  suggestedPrompts: [{ title: 'Status', message: 'What are you working on?' }],
});
console.log(JSON.stringify(manifest, null, 2));
```

Paste the JSON into **Create app → From an app manifest**. If you maintain an
app by hand instead, make sure it has:

| Manifest piece | Value | Why |
|---|---|---|
| `features.agent_view.agent_description` | your agent's description | Enables the Agent messaging experience; `assistant_view` is deprecated |
| `settings.event_subscriptions.bot_events` | includes `agent_session_stopped` | Slack only shows the native stop button if the app subscribes to this |
| `oauth_config.scopes.bot` | includes `chat:write` | Required by `agents.sessions.setStatus` / message sending |
| `settings.socket_mode_enabled` | `true` (Socket Mode) | Default transport; HTTP receiver also supported |

The full bot scope list lives in `REQUIRED_BOT_SCOPES`
(`packages/channel-slack/src/manifest.ts`); the event list in `BOT_EVENTS`.

> **Existing apps still on `assistant_view`:** applying a manifest containing
> `agent_view` migrates the app permanently — Slack does not allow reverting
> to `assistant_view` — and users may need a hard refresh of Slack to see the
> new experience. If you are regenerating a manifest for such an app and are
> not ready to migrate, pass `agentView: false` to `buildSlackManifest()` to
> omit the block. (Manifests produced by this generator never contained
> `assistant_view`, so regenerating one of its own manifests does not migrate
> anything.)

### 2. Create the Omni instance

Provide the tokens as instance credentials:

```jsonc
{
  "channel": "slack",
  "config": {
    "botToken": "xoxb-...",
    "appToken": "xapp-...", // Socket Mode
    "mode": "socket"         // or "http" + signingSecret
  }
}
```

See `SlackConfig` (`packages/channel-slack/src/types.ts`) for every option:
DM policy (`dmPolicy`, `dmAllowlist`), channel allow/blocklists, stream mode
(`streamMode`, `streamThrottleMs`), reply-to mode, ack reactions
(`ackReaction`, `removeAckAfterReply`), display defaults (`defaultUsername`,
`defaultIconUrl`/`defaultIconEmoji`), HTTP mode (`httpPort`, `signingSecret`),
retry config, and user-token mode (below).

### User-token (`xoxp`) mode (#889)

Set `authMode: 'user'` and provide a `userToken` (`xoxp-...`) to have the
instance act as a user instead of (only) a bot:

```jsonc
{
  "channel": "slack",
  "config": {
    "botToken": "xoxb-...",   // still required — Bolt authenticates with it
    "appToken": "xapp-...",
    "authMode": "user",
    "userToken": "xoxp-..."   // prefix-validated; an xoxb here is rejected
  }
}
```

The **bot token stays mandatory** in user mode: it authenticates the Socket
Mode connection and is the fallback for scopes the user token lacks. User mode
is required for `search.messages` (the `search:read` scope only exists as a
user scope).

### 3. Verify

Mention the bot inside a thread (or DM it) while an agent provider is
configured. You should see:

- the session status ("working") while the provider runs,
- a native stop button (press it — the provider run aborts and the status
  clears),
- the streamed reply rendered word-by-word (native `chat.startStream` when the
  workspace supports it).

## Messaging features (#889)

Beyond send/receive, the Slack plugin supports:

- **Threads** — `thread_ts` resolution via `replyToMode`, thread history
  through `conversations.replies`, and thread roots/reply counters recorded on
  messages.
- **Scheduled messages** — native `chat.scheduleMessage` (text-only), surfaced
  as `omni schedule send <instance> <chat> "..." --at 2h` and
  `POST /api/v2/scheduled-messages`. Cancel with `omni schedule cancel <id>`.
- **Permalinks** — `GET /api/v2/messages/:id/permalink` resolves via
  `chat.getPermalink` and caches on the message row.
- **Pins** — `pin_added`/`pin_removed` events populate `pinnedAt`/`pinnedBy`
  on messages; agents get `pins.add`/`pins.remove` tools.
- **Message search** — `omni slack search <instance> <query>` wraps
  `search.messages`. Requires user-token mode (`search:read` is a user scope);
  results are from the authorizing user's perspective.
- **DM open** — `omni slack dm <instance> <userId>` resolves/opens the DM
  channel for a `U…` user id and prints the follow-up send command.

## Socket health (#941)

A Slack instance can look "connected" while its WebSocket is deaf —
`auth.test` is HTTPS and stays `ok` even when the Socket Mode WSS never
opened. Omni therefore verifies the real WebSocket `readyState` on connect
(waiting for the `connected` event with a timeout) and health checks fail
first on a dead socket rather than trusting `app.start()`.

## Status & stop internals

| Concern | Where |
|---|---|
| Status calls (`agents.sessions.setStatus` + legacy fallback) | `packages/channel-slack/src/handlers/typing.ts` |
| Thread resolution for status (`activeThreads`) | `packages/channel-slack/src/plugin.ts` (`sendPresenceStatus`) |
| `agent_session_stopped` handling | `packages/channel-slack/src/handlers/agent-sessions.ts` |
| Run abort propagation (`agent.run.cancel_requested`) | `packages/api/src/plugins/agent-dispatcher.ts` (`cancelActiveAgentRun`) |
| Manifest generation | `packages/channel-slack/src/manifest.ts` |

## References

- [Agent messaging experience migration guide](https://docs.slack.dev/ai/migrating-to-agent-messaging/)
- [`agents.sessions.setStatus`](https://docs.slack.dev/reference/methods/agents.sessions.setStatus/)
- [`agent_session_stopped` event](https://docs.slack.dev/reference/events/agent_session_stopped/)
- [App manifest reference (`agent_view`)](https://docs.slack.dev/reference/app-manifest)
