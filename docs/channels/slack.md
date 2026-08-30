# Slack Channel

> Slack bot integration via Bolt.js (Socket Mode or HTTP), with the Agent
> messaging experience (`agent_view` + Agent Sessions API), native streaming,
> reactions, pins, slash commands, and an optional user-token mode.

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
  long `claude-code` run nobody wants) and clears the session status.

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

> Existing apps still on `assistant_view`: switching the manifest to
> `agent_view` renames `assistant_description` → `agent_description`, cannot
> be reverted, and users may need a hard refresh of Slack to see the new
> experience.

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
DM policy, channel allow/blocklists, stream mode, reply-to mode, slash
commands, and user-token mode (`authMode: 'user'`, #889).

### 3. Verify

Mention the bot inside a thread (or DM it) while an agent provider is
configured. You should see:

- the session status ("working") while the provider runs,
- a native stop button (press it — the provider run aborts and the status
  clears),
- the streamed reply rendered word-by-word (native `chat.startStream` when the
  workspace supports it).

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
