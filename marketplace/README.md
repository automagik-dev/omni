# Automagik marketplace

`automagik.json` is Omni's own [DeepSeek Harness](https://github.com/deepseek-ai) plugin market index (format 1):
Omni's plugins, with their titles, categories and labels, plus the Automagik plugins they build on (the Bot team
and the welcome) at the release Omni was tested with. It lists nothing else: the outside plugins Automagik vetted
for bringing your own AI are in [Automagik's index](https://github.com/automagik-dev/automagik/tree/dev/marketplace).
Every Omni serves this index for its own release (below), and the Automagik market lists it at each Omni release,
beside Automagik's other products:

```
https://raw.githubusercontent.com/automagik-dev/dsh-marketplace/main/index.json
```

That is the URL to add to a DSH without an Omni ([automagik-dev/dsh-marketplace](https://github.com/automagik-dev/dsh-marketplace)
follows Omni's releases and lists Omni's plugins at each one, each at its own version).

Each of Omni's plugins carries the Omni version of its last change: a release moves a plugin to its version only
when something in the plugin's folder changed since the plugin's version was cut, so an unchanged plugin keeps one
version (one listed entry, one commit) across Omni releases. Each declares the oldest Omni it works with in
`engines.omni` (`>=<release>`, checked against that release's API by `scripts/plugin-compat.ts`) and the Bot team it
needs in `peerDependencies['@automagik/bots-dsh']`.

## Every Omni is a marketplace

Each Omni serves the Automagik marketplace for its own release, so a DSH pointed at an Omni installs exactly the
plugins that Omni shipped with:

```
https://<your-omni>/api/market/index.json
```

| Route | What it is |
|-------|------------|
| `/market` | The catalog, and how to add the index to a DSH (`/api/market` redirects there) |
| `/api/market/index.json` | The market index: Omni's own plugins, each at its own version (the Omni release of its last change), and Automagik's at the release Omni pins |
| `/api/market/npm/` | An npm registry for Omni's own plugins; any other package name redirects to registry.npmjs.org |

A reverse proxy that passes only `/api/*` to Omni must pass `/market` too, unauthenticated, for the page.

Omni's own entries are npm sources whose `registry` is that Omni (`https://<your-omni>/api/market/npm/`). The
tarballs come from the release itself: `scripts/pack-market.ts` packs every `apps/*-dsh` plugin with `bun pm pack`
into the CLI's `dist/market` (with a `market.json` manifest) when the CLI is packed, and adds the Bot team and the
welcome as the tarballs of the Automagik release `apps/automagik.json` pins (`apps/automagik.mjs` downloads them and
refuses any whose integrity is not the pinned one; `AUTOMAGIK_TARBALLS` names a folder that already holds them, for
an offline build). So an Omni serves the Bot team at the Automagik version it was tested with. A server run from
source has no packed plugins and lists Automagik's plugins, from their pinned commit, only;
point `OMNI_MARKET_DIR` at a `bun scripts/pack-market.ts <dir>` output to serve them. The links use
`OMNI_PUBLIC_URL` when it is set, else the address the request came in on.


## Add it to your DSH

The market ships with DSH as an optional bundle. Turn it on, then add the index:

1. Settings → Plugins → enable **Plugin market** (`@deepseek-ai/dsh-experimental-plugin-market-bundle`).
2. Market → Indexes → add the Automagik market URL above (or your Omni's `/api/market/index.json`). Or put it straight into your profile's `cordis.patch.yml`:

   ```yaml
   - id: plugin-market
     config:
       indexes:
         - https://raw.githubusercontent.com/automagik-dev/dsh-marketplace/main/index.json
   ```

DSH asks before it installs anything, and installs exactly the version listed.

## What is listed

| Plugin | Source | Notes |
|--------|--------|-------|
| `@automagik/bots-dsh` | [automagik-dev/automagik](https://github.com/automagik-dev/automagik), `apps/bots-dsh`, at the release `apps/automagik.json` pins | The Bot team the others build on (formerly `@automagik/omni-dsh`). Keeps its files in `~/.omni`, never in your DSH profile. |
| `@automagik/omni-channels-dsh` | this repository, `apps/omni-channels-dsh`, pinned to a commit | Omni channels: link your Omni, its channels, chats and automations. Needs the Bot team. |
| `@automagik/omni-canvas-dsh` | this repository, `apps/omni-canvas-dsh`, pinned to a commit | Omni canvases: live UI in the chat, drawn from your Omni. Needs the Bot team and channels. |
| `@automagik/welcome-dsh` | automagik-dev/automagik, `apps/welcome-dsh`, at the release `apps/automagik.json` pins | The welcome and Connect AI (formerly `@automagik/omni-ai-dsh`). |

The Claude Code provider and the AI subscriptions add-ons moved to Automagik's index with the rest of the
outside plugins Automagik vets; `make marketplace-check` refuses any source other than a commit of this
repository or of Automagik.

## Maintaining the index

Omni's own entries are git sources, so nothing is published to npm, and neither market needs a hand-made release:
an Omni's market is packed from the release it serves, and the Automagik market lists each Omni release by
itself. This file follows Omni too: pinning a release candidate (`.github/workflows/pin-candidate.yml`) lists
each of Omni's plugins at its version in the candidate, in the same commit that pins the public channels: a version
new at the candidate is added at the candidate's tag commit, and one already listed keeps its entry (its commit and
time), which `pin` refuses unless the plugin's folder is byte-identical there. `make marketplace-check` fails when an
entry's commit does not hold the version it names. Here, keep the entries' paths, titles, categories and labels current. To list an unreleased commit (for a test DSH, not committed):

```bash
bun scripts/marketplace.ts pin <commit-or-branch>   # list Omni's plugins at their version there (adds a version when one moved on)
make marketplace-check                             # DSH's parser, plus: each commit is in the history and holds the package
```

Pinned commits must stay reachable, so the branches that carry them are merged with merge commits, never squashed.
