# Omni canvases for DSH

`@automagik/omni-canvas-dsh` lets Omni, the Main Bot of the Bot team for DeepSeek Harness
(DSH), show what it found as a canvas: an openui-lang program that the chat renders as live
UI (an overview, a list, numbers, a channel's QR code, a chat). It sits on the team plugin
(`@automagik/bots-dsh`, from automagik-dev/automagik; or its former name
`@automagik/omni-dsh`) and the channels plugin (`@automagik/omni-channels-dsh`), and needs
both: a canvas reads omni through Omni's own reads. The team's
[README](https://github.com/automagik-dev/automagik/tree/dev/apps/bots-dsh#three-plugins) shows how the three fit.

> Labs release. Features, tools and the saved data format can still change.

## What it adds

- **`show_canvas`**, for a Main Bot only. It checks a program against the components the
  chat can draw before the user sees it; a refused one goes back to Omni with what to fix.
- **The canvas language** in the Main Bot's rules, written at build time from the same
  component definitions the chat renders (`src/host/omni-ui-prompt.js`), as the last part of
  its rules. It is there only while an Omni is named.
- **The renderer**: canvases in a `show_canvas` call or in a reply's ```` ```openui-lang ````
  block are drawn live. A canvas may only read omni (`Query` with Omni's read tools or
  `omni_get`); it cannot change anything.

## Install

The plugin needs DSH `>=0.2.1-rc.2 <0.3.0`, the Bot team plugin (`>=3.1.0 <3.261000.0`), the
Omni channels plugin and an Omni no older than its `engines.omni` minimum. Its version is the
Omni release of its last change, so it can trail the newest Omni. Add the Automagik marketplace index to DSH's plugin market
([marketplace/README.md](../../marketplace/README.md) has the URL and the steps) and install
`@automagik/omni-canvas-dsh` from it. DSH applies the bundle patch (`cordis.patch.yml`),
which adds one row, `id: omni-canvas`, and changes nothing else. Restart DSH.

## How it plugs in

- **Host**: it injects `omniTeam` and `omniChannels` and installs `src/host/canvas.js` on a
  runtime whose prototype is the channels runtime. It adds the canvas rules through the
  team's `rt.hooks.mainRules` and registers `show_canvas` on its own fiber. The check runs
  from `src/host/omni-ui-check.bundle.js`, so the host needs no OpenUI or zod installed.
- **Browser**: `client.js` names `@automagik/bots-dsh/client` (or its former name) and
  `@automagik/omni-channels-dsh/client` in `dsh.client.external`, so DSH loads both first and
  this bundle shares them. It sets the team's canvas renderer, registers the `show_canvas`
  card, brings its Chinese copy through `addStrings`, and draws omni with the channels
  plugin's live views (a channel, its QR code, a chat). OpenUI and zod are bundled here only.

## Develop

```sh
npm ci               # esbuild, OpenUI and zod, for the bundles and the prompt (see below)
bun run harness      # the pinned DSH release the tests and the linter run against
bun run test         # composes the team, the channels and this plugin, on Node
bun run lint
bun run build        # rewrites client.js, src/host/omni-ui-prompt.js and src/host/omni-ui-check.bundle.js; commit them
node scripts/build-client.mjs --check
```

The folder's own lockfile is npm's, as the channels plugin's is: Bun resolves every peer from
the registry, and this plugin peers on the Omni plugins, which are not on npm.

The tests load the team plugin from automagik-dev/automagik at the release
`apps/automagik.json` pins (fetched into `apps/.automagik`, or `OMNI_DSH_CORE`) and the channels
plugin from `../omni-channels-dsh` (or `OMNI_DSH_CHANNELS`), with their committed
`client.js` files, and check that a Main Bot's prompt with all three is the text it was
before the split, byte for byte.

| Path | Purpose |
|---|---|
| `index.js` | Host entry: the runtime on the channels runtime |
| `src/host/` | `show_canvas` and the canvas rules (`canvas`), the generated prompt and check bundle |
| `src/client/` | The renderer (`omni-ui`), its component definitions (`omni-ui-spec`) and check (`omni-ui-check`); `core.js` is what it takes from the other two clients |
| `client.js` | Built from `src/client/` by `scripts/build-client.mjs`; committed |
| `test/` | Unit tests; `team.js` composes the three |

## License

[Apache-2.0](LICENSE)
