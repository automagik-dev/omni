# Automagik marketplace

`automagik.json` is a [DeepSeek Harness](https://github.com/deepseek-ai) plugin market index (format 1).
Add it to any DSH and its market lists Omni's plugins, plus the third-party plugins Automagik vetted for bringing
your own AI.

```
https://raw.githubusercontent.com/automagik-dev/omni/labs/marketplace/automagik.json
```

## Every Omni is a marketplace

Each Omni serves the Automagik marketplace for its own release, so a DSH pointed at an Omni installs exactly the
plugins that Omni shipped with:

```
https://<your-omni>/api/market/index.json
```

| Route | What it is |
|-------|------------|
| `/api/market` | The catalog, and how to add the index to a DSH |
| `/api/market/index.json` | The market index: Omni's own plugins at Omni's version, plus the vetted add-ons below |
| `/api/market/npm/` | An npm registry for Omni's own plugins; any other package name redirects to registry.npmjs.org |

Omni's own entries are npm sources whose `registry` is that Omni (`https://<your-omni>/api/market/npm/`). The
tarballs come from the release itself: `scripts/pack-market.ts` packs every `apps/*-dsh` plugin with `bun pm pack`
into the CLI's `dist/market` (with a `market.json` manifest) when the CLI is packed. The vetted add-ons come from
this file, built into the server. A server run from source has no packed plugins and lists the add-ons only;
point `OMNI_MARKET_DIR` at a `bun scripts/pack-market.ts <dir>` output to serve them. The links use
`OMNI_PUBLIC_URL` when it is set, else the address the request came in on.

The index in this folder stays for DSH users without an Omni.

## Add it to your DSH

The market ships with DSH as an optional bundle. Turn it on, then add the index:

1. Settings → Plugins → enable **Plugin market** (`@deepseek-ai/dsh-experimental-plugin-market-bundle`).
2. Market → Indexes → add the URL above (or your Omni's `/api/market/index.json`). Or put it straight into your profile's `cordis.patch.yml`:

   ```yaml
   - id: plugin-market
     config:
       indexes:
         - https://raw.githubusercontent.com/automagik-dev/omni/labs/marketplace/automagik.json
   ```

DSH asks before it installs anything, and installs exactly the version listed.

## What is listed

| Plugin | Source | Notes |
|--------|--------|-------|
| `@automagik/omni-dsh` | this repository, `apps/omni-ui-dsh`, pinned to a commit | Omni team: the Bot team the others build on. Keeps its files in `~/.omni`, never in your DSH profile. |
| `@automagik/omni-channels-dsh` | this repository, `apps/omni-channels-dsh`, pinned to a commit | Omni channels: link your Omni, its channels, chats and automations. Needs Omni team. |
| `@automagik/omni-canvas-dsh` | this repository, `apps/omni-canvas-dsh`, pinned to a commit | Omni canvases: live UI in the chat, drawn from your Omni. Needs Omni team and channels. |
| `@automagik/omni-ai-dsh` | this repository, `apps/omni-ai-dsh`, pinned to a commit | The Omni welcome and Connect AI. |
| `dsh-codex-subscription` 3.1.3 | npm | ChatGPT/Codex plan through DSH's own Codex sign-in. Personal use under the vendor's terms. |
| `dsh-oh-my-claude` 1.5.4 | npm | The official Claude Code CLI as a provider. Personal use under the vendor's terms. |
| `dsh-kimi-subscription` 1.3.10 | npm | Kimi Code membership. Its own update button can move past this vetted version. |
| `dsh-opencode-go` 0.1.24 | npm | Not yet tested on 0.2.1-rc.2; DSH's built-in `opencode-go` route covers basic use. |

DSH 0.2.1-rc.2 already signs in to DeepSeek, Codex, Claude and Kimi, and takes API keys for Z.ai, OpenCode and
the other pi-ai providers, without any of these.

Vetting means: no install scripts, no telemetry, credentials kept in DSH's own store, and the source read at the
listed version. A new version is listed only after the same review.

## Maintaining the index

In this file, Omni's own entries are git sources, so nothing is published to npm. An Omni's own market needs no
maintenance: it is packed from the release it serves. After a change to one of Omni's plugins lands:

```bash
bun scripts/marketplace.ts pin <commit-or-branch>   # point Omni's entries at it (adds a version when it moved on)
make marketplace-check                             # DSH's parser, plus: each commit is in the history and holds the package
```

Pinned commits must stay reachable, so the branches that carry them are merged with merge commits, never squashed.
