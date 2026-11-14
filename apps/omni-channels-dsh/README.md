# Omni channels for DSH

`@automagik/omni-channels-dsh` brings your Omni into the Bot team for DeepSeek Harness
(DSH): link this DSH to an Omni, see its channels and chats, and let Omni, the Main Bot,
operate the platform and run your automations. It sits on the team plugin
(`@automagik/bots-dsh`, [apps/bots-dsh in automagik-dev/automagik](https://github.com/automagik-dev/automagik/tree/dev/apps/bots-dsh#three-plugins))
and needs it; the canvas plugin (`@automagik/omni-canvas-dsh`) sits on this one.

> Labs release. Features, tools and the saved data format can still change.

## What it adds

- **The link to an Omni**: the Channels page pairs this DSH with an Omni by a code you send
  yourself on WhatsApp, and keeps the key the Omni mints in `omni.json` (see below).
- **Channels and chats**: the Channels page (connect a channel, its health) and each chat as
  a main panel; the footer shows the connected channels and a dot when one needs attention.
- **Omni's tools**, for a Main Bot only: `omni_channels`, `omni_chats`, `omni_messages`,
  `omni_connect`, and `omni_endpoints` and `omni_call` for any other operation of the Omni
  API. Each call is drawn in the chat as a card. With an Omni named, a Main Bot's Sessions
  lose DSH's shell and file tools and the team's `start_task`: Omni has no computer, and
  says what such work needs so the user can give it to a Bot that has one.
- **Automations**: `find_chats`, `list_automations`, `save_automation`, `pause_automation`
  and `delete_automation`; Omni's event streams start a run for each match. The board is a
  tab of DSH's right sidebar beside Omni's chat, and the account menu opens the Automations
  page. A run for an event only reads omni. A "thread" worker runs each event in the thread
  of the chat it came from, making that chat a thread first when it is none, so an
  automation over many chats works in one thread per chat, drawn under the Omni Bot's row.
- **Omni's rules**: how to operate Omni, that it has no computer, and how to run automations,
  as a part of the Main Bot's rules inside the team's prompt section.
- **Connect Omni**, the onboarding step `omni-connect` (order −250), between the Omni AI
  plugin's welcome (−300) and Connect AI (−200). A skip is kept by `@automagik/welcome-dsh`
  when it is installed, else in this browser.

## Bind each answer child to its person

An answer bot's settings have **Bind each child to its person** (`personBinding`, off by
default; set in the settings panel only, never by a model tool). It needs isolated visibility,
and the file tools off or limited to a knowledge folder.

While it is on, the first message for a chat that an Omni access rule naming one person admits
(an allow rule with a `platformUserId`, or a `phonePattern` with no `*`) binds that chat's child
to the rule, once. A later message for that chat admitted by another rule, or by none, is held:
it reaches no child, and the host warns once. A message that access control lets in without such
a rule (access off, a wildcard) binds nothing.

The rule is the person's only record. Staff write its `metadata` (`POST`/`PATCH
/access/rules`, a JSON object of at most 16 KB):

```json
{
  "context": "Text about this person, for their child only.",
  "capability": { "name": "orders-for-this-person", "secrets": ["ORDERS_TOKEN_FOR_THIS_PERSON"] }
}
```

- `context`: text (up to 8000 characters) that only this person's child reads, in its own
  section of its instructions. A change is read again within 30 seconds.
- `capability`: an MCP capability saved in the team's Settings > Capabilities, as its name or as
  `{ name, secrets }` with exactly the secrets it uses (each saved for no Bot). The Bot team
  mounts it into this child's Session only, and the child's guard admits its tools by their
  `mcp__<name>__` prefix in that Session alone. Its calls run without a staff card. On a Bot team
  that cannot mount one, or when the mount needs approval or fails, the child answers without it
  and the host warns once. It leaves the Session when the rule stops naming it, when binding is
  switched off, or when the child is removed.

Context and capability are kept in memory only: after a restart they return with the person's
next admitted message.

## A first message before Omni knows the phone

A WhatsApp sender can first arrive by their lid alone, before Omni has looked up their phone, so
an access rule by phone cannot match them yet. Answer mode keeps such a message (in the plugin's
saved state, so a restart keeps it) and checks it again about 2, 10 and 30 seconds later, then
each minute, with the phone Omni has learned for the chat by then (the chat's `canonicalId`).
When a rule admits the person, or a later message of theirs in that chat is admitted, the kept
messages reach the child once, oldest first, bound by that rule. A kept message is dropped once
it is older than the channel's `inboundMaxAgeMinutes`, by its platform time.

If the sender is still not matched after 30 seconds and the channel has an allow rule by phone,
the host warns once and the bot's sidebar shows "1 message waiting: sender not matched yet". A
sender whose phone is known and matches no rule is refused as before, without a marker.

## A reply for people who are not let in

By default a sender that no allow rule matches gets no answer. Staff can set one reply under
**Reply to people who are not let in** (`strangerReply`, at most 1000 characters, settings panel
only; empty turns it off). With a reply set, such a sender gets it once a day per chat, in the
chat they wrote from, through Omni's send for that chat, and only after their own message. No
answer child is made or woken for them. A sender known only by their lid gets it once the
30-second check still finds no rule, or as soon as a check finds a phone no rule allows. Their
message then leaves the kept messages, with no warning and no marker. A rule that matches at an
earlier check admits them as before. Only the allowlist's default refusal gets the reply: a
sender that a rule of its own refuses (block or silent_block, on any of their ids) gets nothing
and is not listed. A check that failed, a message that is too old, a group, history and the
number's own messages get nothing. A failed send takes the day's mark back, so the person's next
message tries again; nothing tries on a timer, and the failure is warned once per chat until a
send there works.

Each sender who gets the reply is listed under **Requests** in the answer settings: one row per
chat, with the ids they wrote from, their first text (500 characters), when they last wrote and
how many messages they sent. The list keeps the newest 500 rows per bot, and the day's marks keep
the newest 5000 chats. Both are saved, so they outlive a restart. Only staff read the list, on the
`omni-answer-requests` route; no tool reads it.

## When a person needs someone from the team

An answer child that cannot help its person calls `thread_needs_staff` with a one-line reason
(1 to 200 characters), then tells the person the team has been told; its fixed instructions say
so, whatever the bot's own instructions say. The tool sends nothing to the person and raises no
card, in training and in sending mode alike. Only answer children may call it, and a child that
staff took over is refused: staff are in its chat already.

The team is told once: the owning bot gets a note in its own chat naming the chat and the
reason, the child's row in the sidebar shows **Needs a person** with the reason and a
**Dismiss** button, and, when staff pick one under **Staff chat when a person is needed**
(`needsStaffChatId`, settings panel only), that chat gets a short message on the bot's channel.
The staff chat can never be a chat an answer child answers. The mark is saved, so it outlives a
restart; calls while it is set tell no one again. It clears when staff answer in that chat from
their own phone, or when they press **Dismiss**. DeepSeek Harness has no app notification a plugin
can raise, so the sidebar row is the app's own sign.

## Existing channel settings

Open an existing channel to read its configuration groups, derived provider and assigned
agent. Changes use the linked key and the existing `instances:write`/`canWrite` gate;
read-only devices can inspect settings but cannot save or reconnect. The agent picker
lists up to 200 agents; the UUID field also accepts another accessible agent or an empty
value to unassign it. Agent assignment keeps Omni's existing routing/key provisioning.

Settings load with `GET /instances/{id}` and save only edited fields with `PATCH` on that
same id. JSON fields accept structured values; **Clear override** sends null only for
nullable fields. Provider is derived from the agent, never written here. Some transport
settings apply at next connection. Older Omni versions may reject newly added fields;
update Omni rather than recreating a channel when it reports an unsupported setting.

For WhatsApp Business, repair the Meta identifiers and re-enter the access token under
**Repair and reconnect**. This calls the existing instance's Business connect route,
never creates/deletes an instance, and never reads back or persists a token in the browser.
Save any identifier clears first. Connection failure may still have saved credentials;
retry on the same channel. Meta display-number lookup is best effort, so it can stay null.
The Meta API version is a provisioning snapshot; runtime environment takes precedence.

### Reproduce the scoped SDK update for #1403

The base SDK predates unrelated auth routes. Refresh only the five affected members below,
using **exact bytes** from a full OpenAPI generation, rather than pulling that drift into
this feature. Run from the repository root with installed dependencies. This keeps every
old request key and response requirement; `audioTranscription` and `inboundReplyContext`
become required in SDK responses because they were already required in the base API
(the stale SDK had 14 required fields, the API has 16). No types are handwritten.

```sh
mkdir -p .git/local-isolation/sdk-scope
bun -e 'import {openApiSpec} from "./packages/api/src/routes/openapi"; await Bun.write(".git/local-isolation/sdk-scope/openapi.json", JSON.stringify(openApiSpec))'
bunx openapi-typescript@7.13.0 .git/local-isolation/sdk-scope/openapi.json -o .git/local-isolation/sdk-scope/full.ts
node --input-type=module <<'JS'
import fs from 'node:fs'; import cp from 'node:child_process'; import assert from 'node:assert/strict'; import ts from 'typescript';
const file = 'packages/sdk/src/types.generated.ts', scratch = '.git/local-isolation/sdk-scope/';
const base = cp.execFileSync('git', ['show', '5443fb744c9b022530360b23dc49f8988906eb0e:' + file], {encoding:'utf8', maxBuffer:16*1024*1024});
const full = fs.readFileSync(scratch + 'full.ts', 'utf8');
const parse = text => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const iface = (s,n) => s.statements.find(x => ts.isInterfaceDeclaration(x) && x.name.text === n);
const prop = (s,n) => s.members.find(x => x.name?.getText().replace(/^["']|["']$/g,'') === n);
const selectors = [s => prop(prop(iface(s,'components'),'schemas').type,'Instance'), ...['listInstances','createInstance','getInstance','updateInstance'].map(n => s => prop(iface(s,'operations'),n))];
const before = parse(base), after = parse(full), bytes = (text,node) => text.slice(node.getFullStart(),node.end);
const edits = selectors.map(get => ({old:get(before), next:get(after)}));
let scoped = base;
for (const e of [...edits].sort((a,b) => b.old.pos-a.old.pos)) scoped = scoped.slice(0,e.old.getFullStart()) + bytes(full,e.next) + scoped.slice(e.old.end);
const result = parse(scoped); assert.equal(result.parseDiagnostics.length,0);
for (const get of selectors) assert.equal(bytes(scoped,get(result)),bytes(full,get(after)));
const outside = (text,s) => { for (const n of selectors.map(get => get(s)).sort((a,b) => b.pos-a.pos)) text = text.slice(0,n.getFullStart()) + '<selected>' + text.slice(n.end); return text; };
assert.equal(outside(scoped,result),outside(base,before));
for (const ref of scoped.matchAll(/components\["([^"]+)"\]\["([^"]+)"\]/g)) assert.ok(prop(prop(iface(result,'components'),ref[1]).type,ref[2]));
fs.writeFileSync(file,scoped);
JS
```

Repeat the pinned full-generation command and AST splice: the SDK SHA-256 must stay
identical. The API settings test checks the 16 required response fields and documented
field coverage; run it plus SDK typecheck/build/tests and the normal repository gates.
The AST oracle checks dependency closure and unchanged bytes outside the five selectors.

## Install

The plugin needs DSH `>=0.2.2-rc.1 <0.2.3-0` (from 0.2.2-rc.1 up to the next patch, so rc.1 and rc.2
both load; its tests run on 0.2.2-rc.2; DSH turns the plugin off outside the range), the Bot team
plugin (`@automagik/bots-dsh`
`>=3.87.0 <3.261000.0`: Automagik's 3.N releases from the first that admits DSH 0.2.2) and an Omni no older than its `engines.omni`
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
- **Browser**: `client.js` names `@automagik/bots-dsh/client` in `dsh.client.external`, so
  DSH loads the team's bundle
  first and this one shares it: the host call, the interface
  copy (this plugin's Chinese copy joins it with `addStrings`), and the registries it adds
  its tool cards, account-menu row, row badge, header button and Bot-surface panels to. It
  exports `channels`, the live views of omni the canvas plugin draws with.
- **Data**: the automations and their runs (`subscriptions`, `subscriptionRuns`,
  `omniEventCursors`) stay in the team's `state.json`, saved through the team's lock; a DSH
  that only reads the team does not change them.

## Meta webhook setup

After WhatsApp Business connects, the setup panel shows the deployment's public HTTPS
callback URL and a **Verify token**, masked until **Reveal verify token** is selected.
Each value has its own copy button. Reopen it from the existing Business channel's
**Channel settings → Show webhook setup**; this does not create or reconnect a channel.
Paste the two values into the matching Meta Developers WhatsApp webhook fields, then
verify and save. The Verify token is separate from the Graph API access token.

Retrieval requires an unlocked global Omni key with `settings:write` (or `settings:*`
or `*`) and a writable DSH host. Tenant-bound keys and keys with instance, chat or
outbound locks are refused. Other callers see an unavailable URL state and **ask an
admin**. No callback is inferred from a local API address or request headers.
DSH apps linked through pairing never show the verify token; only the admin keys
described above can retrieve it.

An administrator must configure `server.public_url` (with `OMNI_PUBLIC_URL` as fallback),
`META_VERIFY_TOKEN` and `META_APP_SECRET` on the server. Missing configuration is shown
explicitly. The endpoint returns only whether the app secret is configured, never its
value or a Graph API access token. The verify token is shared across Meta instances,
kept only in the open panel's memory, and the response is `Cache-Control: no-store`.
Connection alone does not prove Meta can reach or verify the webhook. No automatic
Meta registration or credential rotation is performed.

## Own-device voice and media automations

Voice/media triggers are inbound-only by default. When the owner explicitly asks to
include their own outbound media, use `save_automation` with `allow_outbound: true`
(`trigger: "voice"` for audio; `"media"` for photos, videos, documents and stickers).
The saved trigger records `allowOutbound`; later edits retain it unless explicitly
changed or the trigger kind changes. Set `allow_outbound: false` to turn it off.
The board and automation summary show when own-device media is included.

Admission also reads the canonical message through the configured Omni credentials:
it must match the watched chat and external ID, have a live `notify` own-device receipt
on both the journal and stored message, not be history sync, and have no agent
attribution. API-send records, `append` echoes, history replays and `message.sent`
never trigger it. Missing, forbidden, malformed or mismatched lookups are refused
with a warning and acknowledged, so later events can continue. Network errors and
HTTP 408/429/5xx responses share at most three attempts per row, with backoff that
survives stream reconnects. Exhaustion warns, refuses and acknowledges the row. This
currently admits WhatsApp Baileys own-device receipts; other channels without that
receipt shape remain excluded. The existing channel echo guard stays in place.
A second bot linked to the same WhatsApp number can look like the owner's phone;
enabling own-device media may then create a reply loop.

The worker gets the source chat/instance, a message/media reference and available
transcription or processed content, under its existing permissions. If processing is
disabled or still pending but a media URL exists, it receives that reference without
inventing a transcript: the text may be empty, and dispatch does not wait for
transcription. A record with neither usable text nor a media reference is warned,
refused and acknowledged; it is not replayed when processing finishes.

Inbound media and reactions also perform an uncached scoped message read per event,
instead of using the ten-minute name cache. Workers receive the available processed
text and media reference. Reaction triggers retain “you react” semantics and resolve
the referenced message, including its available transcription. This does not replay already-acknowledged
outbound events or change the stream's existing at-least-once delivery contract.

Enabling `allow_outbound` uses the existing trigger-widening permission card for
act-without-asking automations. New and ask-first automations keep their existing
permission flow; the tool instruction to ask before enabling does not add a new card.

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
