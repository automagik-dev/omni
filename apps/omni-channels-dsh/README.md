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
  page. A run for an event only reads omni.
- **Omni's rules**: how to operate Omni, hand work to Tasks and run automations, as a part
  of the Main Bot's rules inside the team's prompt section.
- **Connect Omni**, the onboarding step `omni-connect` (order −250), between the Omni AI
  plugin's welcome (−300) and Connect AI (−200). A skip is kept by `@automagik/welcome-dsh`
  when it is installed, else in this browser.

## Install

The plugin needs DSH `>=0.2.1-rc.2 <0.3.0`, the Bot team plugin (`@automagik/bots-dsh`
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

The key Omni mints is saved in `omni.json` in the team's folder (`$OMNI_HOME/ui`, readable by
you only), with its scopes and expiry; it never reaches the browser. Delete that file to
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
