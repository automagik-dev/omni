# Omni channels for DSH

`@automagik/omni-channels-dsh` brings your Omni into the Bot team for DeepSeek Harness
(DSH): link this DSH to an Omni, see its channels and chats, and let Omni, the Main Bot,
operate the platform and run your automations. It sits on the team plugin
(`@automagik/bots-dsh`, [apps/bots-dsh in automagik-dev/automagik](https://github.com/automagik-dev/automagik/tree/dev/apps/bots-dsh#three-plugins))
and needs it; the canvas plugin (`@automagik/omni-canvas-dsh`) sits on this one.

The team was `@automagik/omni-dsh` (this repository's `apps/omni-ui-dsh`) until it moved to
Automagik. This plugin works on either: in a DSH that still runs `@automagik/omni-dsh`, its
client takes the team's client under that name (`scripts/build-client.mjs`), and the team
runtime is the same `omniTeam` service.

> Labs release. Features, tools and the saved data format can still change.

## What it adds

- **The link to an Omni**: the Channels page pairs this DSH with an Omni by a code you send
  yourself on WhatsApp, and keeps the key the Omni mints in `omni.json` (see below).
- **Channels and chats**: the Channels page (connect a channel, its health) and each chat as
  a main panel; the footer shows the connected channels and a dot when one needs attention.
- **Omni's tools**, for a Main Bot only: `omni_channels`, `omni_chats`, `omni_messages`,
  `omni_connect`, and `omni_endpoints` and `omni_call` for any other operation of the Omni
  API. Each call is drawn in the chat as a card. With an Omni named, a Main Bot's Sessions
  lose DSH's shell and file tools; `start_task` (the team's) hands that work to Tasks.
- **Automations**: `find_chats`, `list_automations`, `save_automation`, `pause_automation`
  and `delete_automation`; Omni's event streams start a run for each match. The board is a
  tab of DSH's right sidebar beside Omni's chat, and the account menu opens the Automations
  page. A run for an event only reads omni. A "new session" worker makes a plain Session for
  each event and an "ongoing session" worker keeps one for all of them; both are drawn under
  the Omni Bot's row beside its chat threads, never under Tasks, and stay until their row's
  menu removes them. On a Bot team with DSH bots, a "dshbot:<name>" worker hands each event
  to one of the owner's DSH bots, in a new Session under it or one ongoing Session there.
- **Omni's rules**: how to operate Omni, hand work that needs a computer to a session under
  the Omni Bot, and run automations, as a part
  of the Main Bot's rules inside the team's prompt section.
- **Connect Omni**, the onboarding step `omni-connect` (order −250), between the Omni AI
  plugin's welcome (−300) and Connect AI (−200). A skip is kept by `@automagik/welcome-dsh`
  when it is installed, else in this browser.

## Install

The plugin needs DSH `>=0.2.1-rc.3 <0.2.2-0` (the DSH its tests run on, up to the next patch;
DSH turns the plugin off outside it), the Bot team plugin (`@automagik/bots-dsh`
`>=3.1.0 <3.261000.0`: Automagik's 3.N releases) and an Omni no older than its `engines.omni`
minimum. Its version is the Omni release of its last change: an Omni release moves it only when
this folder changed, so it can trail the newest Omni. Add the Automagik
marketplace index to DSH's plugin market ([marketplace/README.md](../../marketplace/README.md)
has the URL and the steps) and install `@automagik/omni-channels-dsh` from it. DSH applies
the bundle patch (`cordis.patch.yml`), which adds one row, `id: omni-channels`, and changes
nothing else. Restart DSH.

From a checkout, link it into a profile next to the team plugin; the team's
[README](https://github.com/automagik-dev/automagik/tree/dev/apps/bots-dsh#install) has the profile.

## Connect to an Omni

On the Channels page, type the address of an Omni (for example `omni.example.com`) and
choose **Get a code**. Omni answers with a short code; send it to yourself from WhatsApp
("Message yourself"; **Open WhatsApp** or the QR opens the chat with the code typed). The
page goes live as soon as the code arrives. The Omni must have pairing turned on.

The key Omni mints is saved in `omni.json` in the Bot team's home (`$AUTOMAGIK_BOTS_HOME`, else
`~/.automagik/bots`; `~/.automagik/desktop/bots` in the Automagik app), readable by you only, with its
scopes and expiry; it never reaches the browser. Delete that file to
disconnect; revoke the key in Omni to cut it off from the server side.

Without an Omni, the Connect step can run one on this computer (`omni install --sandbox`). It
installs the newest Omni release that meets the minimum, read from npm's `latest` tag (else
`next`) as one exact version that the step shows before anything runs; offline, the plugin's
own version. A sandboxed Omni below the minimum is offered that release, and one the Omni CLI
runs is offered `omni update`.

A profile can still name an Omni the older way: `omni.url` (the API, without `/api/v2`) in
this row's config, or on the team's `omni-ui` row where it lived before this plugin, and the
`OMNI_API_KEY` credential in DSH's store. A saved link wins over both.

```yaml
- id: omni-channels
  name: '@automagik/omni-channels-dsh'
  config:
    omni:
      url: https://omni.example.com
```

## Delete an instance

A live channel's detail page offers **Delete instance** for every channel type and state.
It uses the existing channel-write ability (read-only keys see a disabled action). The first
click names the instance and its ID and offers **Cancel**; only **Permanently delete instance**
sends a request. Preview **Disconnect** stays local and never calls the API.

The host's standard write endpoint, `omni-channel-act` with `action: 'delete'`, calls the
supported `DELETE /api/v2/instances/{id}` through `rt.omniRequest('DELETE', '/instances/{id}')`.
It does not add a backend permission or deletion policy. Pairing's `omni-channel-cancel`
remains limited to channels created by that unfinished flow
([host actions](<src/host/omni-channel-actions.js>)).

Verified backend semantics: the route attempts runtime disconnect, deletes the instance,
then attempts plugin logout/session cleanup; disconnect and logout failures are best effort
([API route](<../../packages/api/src/routes/v2/instances.ts#L1390-L1420>)). The instance
configuration and its local chats/messages are permanently deleted through the database
cascades ([chats](<../../packages/db/src/schema.ts#L1608-L1612>),
[messages](<../../packages/db/src/schema.ts#L1809-L1815>)). This does **not** guarantee
external token revocation or external account unlinking. Events are not all erased: event
rows retain their data with a null instance reference
([events](<../../packages/db/src/schema.ts#L1981-L1987>)), and the service publishes
`instance.disconnected` with reason `deleted`
([instance service](<../../packages/api/src/services/instances.ts#L489-L516>)).

The page keeps the instance and its chats until the delete succeeds. Failure keeps its
details and gives an error with a retry; success clears only its cached chats/messages,
seen state and matching selection, including cached chats omitted by the recent-chat overview.
A bounded ownership map remembers only current chats or IDs with retained data/selection;
late send callbacks from the deleted instance cannot recreate caches or errors. Sends from
other instances still finish even if their chats leave the recent list.
Navigation to another channel is preserved. Duplicate
submissions are blocked across redraws, and a generation guard discards reads overlapping
deletion so stale polls cannot restore removed data. A refresh failure after successful
deletion is reported separately, without treating deletion as failed
([client store](<src/client/omni-store.js>), [detail view](<src/client/channels.js>)).

## How it plugs into the team

- **Host**: it injects the team's runtime (`omniTeam`) and installs `subscriptions`,
  `omni-api`, `omni-link`, `omni` and `omni-events` on a runtime of its own whose prototype is
  the team's, so they call the team's functions while their tools and effects stay on this
  plugin's fiber. It adds to the team only through `rt.hooks`: the `omni-*` and
  `automation-*` endpoints of `POST /api/omni-ui` (the reads also on a host that only reads
  the team), the automations in the team view, the events Omni listens to in every state
  answer, and the operator rules. It provides its runtime as `omniChannels`.
- **Browser**: `client.js` names `@automagik/bots-dsh/client` (and the team's former name,
  `@automagik/omni-dsh/client`) in `dsh.client.external`, so DSH loads the team's bundle
  first and this one shares it: the host call, the interface
  copy (this plugin's Chinese copy joins it with `addStrings`), and the registries it adds
  its tool cards, account-menu row, row badge, header button and Bot-surface panels to. It
  exports `channels`, the live views of omni the canvas plugin draws with.
- **Data**: the automations and their runs (`subscriptions`, `subscriptionRuns`,
  `omniEventCursors`) stay in the team's `state.json`, saved through the team's lock; a DSH
  that only reads the team does not change them.

## Quiesce automation ingress before unloading

The `omniChannels` host runtime exposes `await rt.quiesceOmniEvents()`. Call and await
this **before** initiating plugin unload or a controlled host restart, while the rest of
the plugin (including subscription permission hooks) remains installed. It permanently
stops this runtime's Omni event ingress; resuming requires a new runtime installation.
It does not disable subscriptions or delete server consumers.

Stopping is synchronous; the returned promise settles after pending load/configuration,
sync, stream and enrichment operations, entered subscription dispatches, acknowledgments
and cursor saves have settled. Repeated calls and the event effect's disposer return the
same promise. Whole-plugin unload may dispose other hooks concurrently: the async event
disposer alone is **not** the safe ingress-only boundary. `omniEventsView().listening: []`
means no active listeners, **not** that pending ingress work has drained.

Rows cancelled before their first subscription dispatch are not acknowledged and do not
advance the local cursor. Buffered rows are discarded and that stream exits. Once a row
has entered its first dispatch, it finishes its captured matching subscriptions (retaining
the existing warn-and-continue dispatch-error policy), then acknowledges and saves before
drain completes. Replacement listeners wait for the previous run of the same consumer to
settle. Failed acknowledgments do not advance the local cursor; a rejected local save
restores its previous in-memory cursor, allowing replay even if the server ack succeeded.
Drain completion means these operations settled, not that persistence succeeded.
The server's validated
monotonic-cursor 400 (this exact row is already behind its durable cursor) is treated as
already acknowledged, allowing a stale local cursor to catch up one processed row at a
time; generic 400s and other HTTP failures are not. Delivery is **at least once**, not
exactly once: cancellation or a failure before acknowledgment can replay a
row, including subscriptions that already dispatched. SSE reads alone do not acknowledge
rows; reconnects use the last locally acknowledged cursor via `Last-Event-ID`.

This is an ingress boundary, **not** a drain of downstream worker turns, bot tasks or
session followups already enqueued by a dispatch. It provides no forced-exit guarantee.
An external request or stream implementation that ignores abort must settle before the
promise can resolve; no deadline silently declares such work drained.

## Develop

```sh
npm ci               # esbuild and qrcode-generator, for the client bundle (see below)
bun run harness      # the pinned DSH release the tests and the linter run against
bun run test         # composes the team (the Automagik release apps/automagik.json pins) with this plugin, on Node
bun run lint
bun run build        # rewrites client.js and src/host/omni-routes.js; commit them
node scripts/build-client.mjs --check
```

The folder's own lockfile is npm's: Bun resolves every peer from the registry, and this plugin
peers on the Omni plugins, which ship through the Automagik market rather than npm.

`client.js` is generated from `src/client` and committed, so git and `link:` installs need
no build step. The tests load the team plugin from automagik-dev/automagik at the release
`apps/automagik.json` pins (`node ../automagik.mjs source` fetches its `apps/bots-dsh` into
`apps/.automagik`; or `OMNI_DSH_CORE`): its `index.js`, its test context, and its committed
`client.js`.

| Path | Purpose |
|---|---|
| `index.js` | Host entry: the runtime on the team's, its modules in order |
| `src/host/` | The link (`omni-link`), reads (`omni`), Omni's tools (`omni-api`, `omni-routes`), events (`omni-events`), automations (`subscriptions`), rules (`omni-rules`) |
| `src/client/` | The Channels page, chats, automations page and board, call cards, Connect Omni; `core.js` is what it takes from the team's client |
| `client.js` | Built from `src/client/` by `scripts/build-client.mjs`; committed |
| `test/` | Unit tests; `team.js` composes the team with this plugin |

## License

[Apache-2.0](LICENSE)
