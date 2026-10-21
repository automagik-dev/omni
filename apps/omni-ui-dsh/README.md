# @automagik/omni-dsh

Omni for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): a team of long-lived Bots that talk to you, to each other and in group chats, with Omni as the Main Bot. With the Omni channels plugin, Omni also operates your Omni channels, chats and automations inside dsh; with the Omni canvas plugin, it shows what it found as live views in the chat (see [Three plugins](#three-plugins)). It is built on [DS Bot](https://github.com/Fei2411/DeepSeek-Bot) (Apache-2.0, see `VENDORED.md`).

> Labs release. Features, tools and the saved data format can still change.

Tested with dsh `0.2.1-rc.2` (Web) on Linux.

**Your own dsh stays yours.** Installed into an existing dsh, Omni keeps its files in `$OMNI_HOME/ui` (`~/.omni/ui`), keeps the key of the Omni it is linked to in its own file there, uses its own route (`/api/omni-ui`), plugin id (`omni-ui`) and browser-storage prefix (`omni-ui:`), overrides no other plugin's configuration, and checks for no updates. It can run beside upstream DS Bot.

## Three plugins

Omni for dsh is three packages. This one is the team; the other two sit on it and add Omni's own parts. Install all three to have everything; the team works alone.

| Package | Folder | Row id | What it adds |
|---|---|---|---|
| `@automagik/omni-dsh` (this one) | `apps/omni-ui-dsh` | `omni-ui` | The Bot team and its surface: Bots, group chats, settings, themes, interface copy, memory, secrets, usage, scheduled tasks, the Bot browser, updates, diagnostics, the `POST /api/omni-ui` route, and the `web-search` plugin |
| `@automagik/omni-channels-dsh` | [`apps/omni-channels-dsh`](../omni-channels-dsh/README.md) | `omni-channels` | The link to an Omni (pairing, `omni.json`), the Channels page and chats, Omni's tools for the platform (and the shell and file tools a Main Bot loses for them), the events Omni listens to, automations and their board, Omni's operator rules, and the onboarding step Connect Omni (`omni-connect`) |
| `@automagik/omni-canvas-dsh` | [`apps/omni-canvas-dsh`](../omni-canvas-dsh/README.md) | `omni-canvas` | `show_canvas`, the canvas check, the canvas language in Omni's rules, and the renderer that draws canvases in the chat (OpenUI and zod live only here) |

How they fit:

- **Host**: this plugin provides its runtime as the `omniTeam` service. The channels plugin injects it, installs its modules on a runtime whose prototype is the team's, and provides that one as `omniChannels`; the canvas plugin injects both and sits on the channels runtime. Each plugin's tools, listeners and effects stay on its own fiber, and it adds to the team only through `rt.hooks` (`src/host/extend.js`): `endpoint(name, fn, { read })` for the `/api/omni-ui` route, `view(fn)` and `live(fn)` for the state answers, and `mainRules(fn, { order })` for a part of the Main Bot's rules, which stay inside the one `bot-identity` section. Each hook returns its disposer, so turning a plugin off takes what it added with it.
- **Browser**: this plugin's `client.js` exports `omni`: the host call, the interface copy (`t`, `addStrings`), the Bot surface's registries (`toolCards`, `nav`, `badges`, `headerButtons`, `onShell`, `setCanvasRenderer`), the running surface (`face`) and a few UI pieces (`ui`). The other plugins name `@automagik/omni-dsh/client` in `dsh.client.external`, so dsh loads this bundle first and hands them the same module instance: one dictionary, one roster, one set of registries.
- **Data**: all three keep the team's one `state.json` and its lock (automations ride it); `omni.json` is the channels plugin's, in the same folder.
- **Upgrading from one package**: a team linked to an Omni whose dsh has only this plugin shows a card in the sidebar footer that points to the plugin market for the channels plugin.

## Features

- **Long-lived Bots**: each Bot is a dsh Session in the "DS Bot" workspace, with its own name, role, instructions and model.
- **Working folders**: a Bot can work in a folder you choose instead of the team workspace, and a group chat can set one folder for all its members there. Pick it in the Bot's settings or details panel or in the group's settings, or ask a Bot (`update_bot`, `update_group`). After a change, the chat goes on in a fresh part that starts in the new folder. When a Bot sets a folder outside the team workspace, or adds a Bot to a group that works in one, it asks for your approval if those Bots can only write in their folder. Folders that hold dsh data (`$DSH_HOME`, the team's data) are refused.
- **Permission presets**: each Bot runs with its own dsh permission preset (Read only, Workspace or Full access), set in its details panel. A group chat can run all its members with one preset there, in place of their own: turn on **Same for every member** under Permissions in the group's settings. Only you set permissions; Bots cannot change them.
- **Bots work together**: `message_bot` sends a message to another Bot, `create_bot` and `update_bot` add and set up Bots, and `ask_user` asks you a question without blocking the other Bots.
- **Group chats**: members speak one at a time, and each one reads the latest messages first. A message can `@Name` a member to pass the turn on; type `@` to pick one from a list. **+ → Reference a chat** adds another Bot's chat to a message as context, and in a group the members who answer get it. A member with nothing new to add stays quiet (`[PASS]`). Each member has its own hidden Session per group, so a group never reads a Bot's private chat.
- **Roles and permissions**:

  | Who | Can do |
  |---|---|
  | You | Everything |
  | Main Bot (there can be more than one) | Manage every group; change and delete Bots |
  | Group admin | Manage its own group only (name, notice, members, reply mode) |
  | Member | Speak in the group and `@` another member |

- **Long chats stay inside the model's window**: dsh's own compaction never runs on a Bot's Session. When a turn ends past the check line (a share of the model's context window), a small separate model call, the context steward, reads the latest messages of the chat and decides once. If the work is still under way, the chat is condensed in place into a checkpoint: a handoff summary plus your recent messages word for word. If the work has reached a stopping point, the Bot writes a handoff note and continues in a new part. Either way you still see one chat, with no marker. Earlier parts and condensed messages stay searchable in a full-text index (`node:sqlite` FTS5) through `read_own_chat`.
- **Memory**: each Bot keeps notes across all its conversations, and the team shares one more. See [Memory](#memory).
- **Web search**: see [Web search](#web-search).
- **Bot browser (dsh Desktop only)**: see [Bot browser](#bot-browser).
- **Images**: for a model that cannot read images, a vision model first turns the image into text.
- **Secrets**: a Bot asks for an API key or token with a card in its own chat and never sees the value. See [Secrets](#secrets).
- **Usage**: Settings → Usage shows token usage by time (24 hours to 12 months, or days picked on a calendar), by Bot and by model, with a page for each Bot and each model. Calls that a Session logs are read from the logs, so older chats count too. Calls that leave no log (checkpoints, handoff notes, the steward, image readings, dsh titles and compaction) are counted while they stream, from the time the plugin runs. Tokens only, no cost.
- **Make it yours**: name, role, instructions, model and look (20 characters and 12 colors, or your own photo) for each Bot; a theme, an accent color and an avatar animation level (quiet, normal or lively) for the team. A pinned Bot or group chat shows a small pushpin in the sidebar. Settings has these pages: General (look), Bots (Main Bots and each Bot's settings), Group chats (each group's settings), Connectors, Capabilities, Scheduled tasks, Usage, Secrets, Feedback and About DS Bot (versions, updates and links).

## Install

The [project page](../README.md#install) has the full steps for dsh Desktop and dsh Web. In short:

- dsh Desktop: Settings → Plugins → add a `.tgz` of this package (`npm pack` in this folder).
- Command line: `dsh plugin --profile web add /path/to/automagik-omni-dsh-<version>.tgz`.
- Or skip dsh setup entirely: the Omni desktop app (`apps/omni-desktop`, `npx @automagik/omni desktop`) ships dsh with this plugin on a home of its own.

To work on the plugins from a checkout, add them to a dsh profile as linked dependencies and bundles (the channels and canvas plugins are optional):

```json
{
  "dependencies": {
    "@automagik/omni-dsh": "link:/path/to/apps/omni-ui-dsh",
    "@automagik/omni-channels-dsh": "link:/path/to/apps/omni-channels-dsh",
    "@automagik/omni-canvas-dsh": "link:/path/to/apps/omni-canvas-dsh"
  },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@automagik/omni-dsh", "@automagik/omni-channels-dsh", "@automagik/omni-canvas-dsh"] } }
}
```

Run `pnpm install` in the profile folder, then start dsh from the deepseek-harness repository:

```sh
pnpm -s dsh --profile web --no-open
```

The first time the team opens, the plugin creates a Main Bot called Omni.

**Upgrading from the `ds-bot` builds of the Omni UI**: earlier builds were named `ds-bot` with the plugin id `bot` and kept the team in `~/.dsh/bot`. Replace `ds-bot` with `@automagik/omni-dsh` in the profile, and set `importHome: ~/.dsh/bot` once (see [Configuration](#configuration)) to copy that team into `~/.omni/ui`; the old folder is left as it was. Browser settings saved under `ds-bot:` are not carried over, because DS Bot uses the same names.

## Connect to an Omni

This needs the Omni channels plugin. On the Channels page, type the address of an Omni (for example `omni.example.com`) and choose **Get a code**. Omni answers with a short code and the WhatsApp number of its pairing channel; send the code to yourself from that WhatsApp ("Message yourself"; **Open WhatsApp** or the QR opens the chat with the code typed). The page goes live as soon as the code arrives. The Omni must have pairing turned on (`OMNI_PAIRING_ENABLED=true` and a pairing instance on the server).

The key Omni mints is saved in `~/.omni/ui/omni.json` (readable by you only), with the scopes the server gives paired keys and an expiry; it never reaches the browser. Delete that file to disconnect; revoke the key in Omni to cut it off from the server side. A profile can still name an Omni the older way, with `omni.url` in this plugin's config (or the channels plugin's) and the `OMNI_API_KEY` credential in dsh's store; a saved link wins over both.

## Configuration

Options go in the profile's `cordis.patch.yml`, under the `omni-ui` entry. All of them are optional.

```yaml
- id: omni-ui
  name: '@automagik/omni-dsh'
  config:
    workspace: /path/to/workspace   # where the Bots work; default <home>/workspace
    home: /path/to/omni-ui-data     # where the team is saved; default $OMNI_HOME/ui (~/.omni/ui)
    importHome: ~/.dsh/bot          # copy a team saved there into home once, when home has none
    checkRatio: 0.8                 # share of the model's usable window where the steward decides
    browser: true                   # force the Bot browser on or off; default on in Desktop only
    memory: true                    # false turns memory off: no memory tools, section or panel
    memoryReview: true              # false leaves memory to the Bots' own remember calls
    diagnosticsFile: false          # keep the error log in memory only; default <home>/logs/diagnostics.jsonl
    updateCheck: false              # the package's own patch sets false: nothing is checked or installed
    updateRegistry: https://registry.example/   # ask only this npm registry for updates
    github: false                   # hide the GitHub connector; default shown in Connectors
```

**Updates**: when a window opens, DS Bot asks where it was installed from for a newer release: the npm registry (the one the DSH plugin manager installs from, then its fallbacks), or the latest GitHub release for a `github:…#vX.Y.Z` install. A newer version shows a cloud button at the top right of the sidebar; **Update** reinstalls DS Bot through the DSH plugin manager, and the new version runs from the next DSH start. A linked or local checkout is never offered an update. Settings → About DS Bot shows the same state, with **Check for updates** to ask again at once.

The same card can carry DSH itself: a DS Bot release may name the DSH release it was verified against (`dsBot.verifiedDsh` in its `package.json`), and only that version is offered — running something newer is a downgrade offer too. A release that names no version offers no DSH update. A DSH installed from npm is swapped by `npm install -g @deepseek-ai/dsh@<version>`. DSH Desktop installs the newest release its own updater finds, so the card shows DSH there only when that release is the verified one, and **Open updates** opens the app's update panel. A release may raise the floor with `dsBot.minBot`: until the bot itself is that new, the DSH row waits.

## Models

Model providers are set up with dsh's `llm-pi-ai` plugin in `cordis.patch.yml`. Every Bot runs on one model of its own, from the models DSH serves. A new team's first Main Bot has none: its chat opens on a model card and it greets the user only after a pick. The Create Bot form starts on the DSH default model. The Bot's details panel and settings (or a Main Bot's `update_bot`) change it; a Bot whose model is no longer served shows the card again. A team saved by an older version keeps the model each Bot last ran on.

- Give every model a `contextWindow`. DS Bot takes its lines from it: the usable window is the window minus the reply reserve (`maxTokens`), the hard line is 95% of that, and the check line is `checkRatio` of it. A model without `contextWindow` gets the adapter's default (262,144 tokens for `llm-pi-ai`), which may be wrong for that model; a model that reports no window at all counts as 500,000.
- To send images, the provider needs `defaultInput: [ text, image ]`.
- Keep API keys out of the repository. Use dsh's own key storage or environment variables.

## Memory

A Bot remembers what should last beyond one conversation: your preferences, decisions, corrections and facts it should not ask again. Memory is plain Markdown in the [Agent Memory Repo](https://github.com/AgentMemoryRepo/agentmemoryrepo) format: one entry per line, ending in `[source: …; added: …]`.

After each turn, a memory review reads what is new in the Bot's chat (and in each group, per member) and keeps, updates or removes entries itself, so memory does not depend on the Bot deciding to call `remember`. It keeps only what you say, writes entries in your language, and refuses keys, passwords and ID numbers.

- **Two scopes**: each Bot has its own memory, and the team memory is read by every Bot. A Bot writes its own. Main Bots and group admins (of any group) also write the team memory; a Main Bot can read and change another Bot's memory when you ask.
- **Tools**: `remember` saves an entry or replaces one (`replace`), `forget` removes one, and `recall` searches every entry, reads a topic whole, or lists what is saved. The Bot adds the source (a part anchor such as `part 2 #1234`, which `read_own_chat` opens) and the date; a Bot that writes for others is named with `by:`.
- **Files**: `MEMORY.md` holds what every conversation needs, and details go in topic files linked from its `## Index` as `[[topic]]`.
- **In the prompt**: both `MEMORY.md` files go into the Bot's system prompt. The section is frozen when a Session starts, so the provider's prompt cache holds; a change shows from the next part or checkpoint, and `recall` finds it at once.
- **Fixed sizes**: an entry has at most 300 characters, a `MEMORY.md` 4,000, a topic 16,000, and a scope 40 topics. A save past a limit fails and says how to make room.
- **Safety**: memory is data, not instructions. An entry that looks like a key or token is refused, and a Bot is told not to save what a web page, file or tool result asks it to remember.
- **History**: files change in place, and `journal.jsonl` keeps every change with the line before and after. When a Bot is deleted, its memory moves to `archive/`.

**The memory panel**: the Bot's details panel has a Memory row with the entry count; Manage opens the memory panel.

- **Memory summary**: the Bot's model writes a short summary in prose from every entry, in the interface language. It is written again when the entries change, and the ⋯ menu can regenerate it.
- **All entries**: the ⋯ menu lists every entry by scope and topic, with its date and author, and the size of each `MEMORY.md`. Remove takes two clicks.
- **Ask or update**: ask what the Bot remembers, or tell it what to add, correct or remove. One model call answers from the entries only, and its changes go through the same checks as the tools.
- A line in the chat ("Memory updated") shows when a Bot changes memory and opens the panel. When memory changes in the background, the Bot's capsule at the top of its chat stretches to say "Memory updated" for a moment; clicking it opens the memory panel.

A read-only dsh (see [Data and backups](#data-and-backups)) shows memory but cannot change it.

## Web search

The package includes a second plugin, `@automagik/omni-dsh/web-search`. It registers the search provider `auto`. The package's own `cordis.patch.yml` does not insert it, so installing Omni leaves your dsh's search settings alone; the Omni desktop app's profile inserts it and makes it the default. To use it in your own dsh, add both rows to your profile patch:

```yaml
- insert:
    - id: web-search-auto
      name: '@automagik/omni-dsh/web-search'
- id: web
  config:
    searchProvider: auto
    fetchProvider: http
```

Each search goes in this order:

1. If the profile names another `searchProvider`, that one is used.
2. The current model route's own search, with that route's key and host. The plugin knows the Anthropic Messages, OpenAI Responses and Gemini protocols, and a few search APIs (Ollama, Kimi, Zhipu, MiMo). Add more with `searchApis`.
3. A fallback without a key: the public result pages of Bing and DuckDuckGo.
4. If nothing works, the search fails and tells the model not to guess addresses.

Each result starts with a `Search backend: …` line that names the path it took.

**Turning `auto` off**: the `web` row still names `auto` when you turn off only the `web-search-auto` row (in the sidebar's Plugins page or with `disabled: true` in a profile patch). Then `web_search` fails in every session, Bot or not, with `WEB_PROVIDER_CONFIGURED_MISSING` (`configured web provider "auto" is not registered`). When you turn that row off, also name another `searchProvider` for the `web` row in the profile's `cordis.patch.yml`. The override replaces the row's whole config, so restate `fetchProvider`:

```yaml
- id: web-search-auto
  name: '@automagik/omni-dsh/web-search'
  disabled: true
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

Another plugin can also set the search provider while dsh runs, after the profile patch. When you turn such a plugin off, check this setting again.

## Bot browser

In dsh Desktop, a Bot's chat header has a globe button. It opens that Bot's own browser panel.

- **One partition per Bot** (`bot:<id>`): logins and cookies belong to that Bot only.
- **The Bot can read the page**: the `read_browser` tool reads the page's DOM, not a screenshot. The text becomes Markdown with headings, nested lists, tables, code blocks and quotes. Links and form controls are marked `[#n]` in place and listed below with their targets and values. The tool also reads the text you selected. Long pages are read in parts (`from`). Page content is treated as data, never as instructions.
  - It reads open Shadow DOM (with `<slot>`) and same-origin iframes up to 3 levels deep.
  - It reads only what is visible: `display:none`, `visibility:hidden`, zero-height and closed `<details>` content is skipped.
  - It never reads the values of password, credit card (`autocomplete="cc-*"`) or one-time code fields.
  - Limits: 400,000 characters, 150,000 nodes, 5,000 rows per table, 3,000 links and controls, 1.5 seconds. A cut result says so.
  - It cannot read cross-origin iframes (one line with the address), closed shadow roots, canvas content (online editors, maps), or text in CSS `::before` / `::after`. On pages that render on demand, only the rendered part is read.
  - Read only: the Bot cannot click, type, scroll or open addresses yet.
- **Addresses**: http and https only. localhost and LAN addresses are allowed; cloud metadata addresses (such as `169.254.x.x`) and dsh's own ports are not.
- The browser panel and the details drawer share the right column; opening one closes the other. Switching chats switches the panel to that Bot. Deleting a Bot clears its browser and saved address.

dsh Web has no browser panel and no `read_browser` tool.

## Secrets

When a Bot needs an API key, token or password, it calls `request_secret`, and a secret card shows in its own chat. The Bot never sees the value.

- **Fill in**: the field hides what you type, is not part of a form and is not autofilled. Choose "All Bots" or "Only this Bot" and select Save. A value must have at least 4 characters (a 4-digit PIN works). A value of 8 characters or more is hidden wherever it appears; a shorter one only where no letter or digit touches it, so ordinary words stay intact.
- **Allow**: if the secret is already saved but this Bot is not allowed to use it, the card only asks whether to allow it. You can also replace the value there.
- **Use**: the value goes into the Bot's shell environment as `DSH_SECRET_<NAME>` (`$DSH_SECRET_NAME` in bash, `$env:DSH_SECRET_NAME` in PowerShell). `list_secrets` lists the names a Bot can use. An MCP capability can also take `$DSH_SECRET_<NAME>` in its env, its headers and its URL (path or query); in the URL the value is URL-encoded. Use headers when the server accepts them.
- **Masking**: before a tool result is saved and before each request goes to the model, every copy of a secret value is replaced with `[secret:<NAME>]`.
- **Manage**: Settings → Secrets lists every secret by name, purpose, the Bot that asked and the last use. You can change who may use it, replace the value, delete it or add one. Deleting a Bot removes it from every secret.
- **Storage**: `<DSH_HOME>/bot/secrets.json`, file mode 600, written atomically. Values are never in `state.json` or logs.

Limits:

- On Windows, the file mode has no effect; the file is protected by your user folder only.
- Only exact copies of a value are masked. A Bot that encodes, splits or reverses a value can still print it. Do not give important secrets to a Bot you do not trust.
- On a page that is not HTTPS (for example dsh Web opened over http on a LAN), the value crosses the network in clear text. The card warns you.
- Group chats show no cards; a Bot asks in its own chat.

## Data and backups

The plugin saves its data in `config.home`. Without it, the folder is `$OMNI_HOME/ui`, or `~/.omni/ui` when `OMNI_HOME` is not set. It writes nothing of its own under `DSH_HOME`; the Bots' Sessions are dsh Sessions, and dsh keeps those.

| System | Default folder |
|---|---|
| Linux, macOS | `~/.omni/ui/` |
| Windows (WSL) | `~/.omni/ui/` inside the WSL distribution |

- To move Omni's data, set `OMNI_HOME`, or `home` in the configuration (see [Configuration](#configuration)).

Files in `ui/`:

| File | Content |
|---|---|
| `state.json` | The team: Bots, groups, Bot-to-Bot messages, preferences and open questions. A long message keeps only its first 2,000 characters here; all of it is in the Session it went to. |
| `group-lines/` | Long group lines, up to the 20,000 characters a member reads, one file per line; each is removed when its line leaves the group's latest 60 lines or the group is deleted |
| `state.lock` | The dsh that is using this data (pid and host). It is removed when that dsh exits. |
| `chat-index.sqlite` | Full-text index of older chat parts (`read_own_chat`); rebuilt if deleted |
| `usage.sqlite` | Token counts for the Usage page; rebuilt from the Session logs if deleted, losing only the calls outside the logs and the names of deleted Bots |
| `memory/` | Memory (see [Memory](#memory)): `bots/<id>/` and `team/` (`MEMORY.md` and topics), `journal.jsonl` (every change), `snapshots/` (the section each Session froze), `summaries/` (the panel's summary; safe to delete), `reviewed.json` (how far the memory review has read) and `archive/` (deleted Bots) |
| `ocr.json` | Cache of image text; safe to delete |
| `workspace` | The team workspace: the working folder of every Bot without one of its own (`config.workspace` changes it) |
| `secrets.json` | Saved secrets. Treat backups of it like passwords. |
| `omni.json` | The Omni this UI is linked to (kept by the channels plugin): its URL and the key pairing minted (0600). Treat backups of it like passwords. |
| `logs/diagnostics.jsonl` | Recent errors and warnings, with keys, tokens, saved secrets and the home folder removed. It moves to `diagnostics.jsonl.1` past 1 MB. Safe to delete. |

The chats themselves are dsh Sessions and are not in `bot/`: they are in `~/.dsh/sessions/`. dsh keeps its workspace list in `~/.dsh/storages/workspace.json` and profiles (with model settings) in `~/.dsh/profiles/`. Bot browser logins are not saved: Desktop keeps each Bot's partition in memory only.

**Back up and restore**

1. Quit dsh completely (both the Web server and Desktop), so `state.json` is current.
2. Copy all of `~/.dsh/` (at least `bot/`, `sessions/` and `storages/`). A copy of `bot/` alone loses the chats.
3. To restore, quit dsh, put the folder back in the same place, then start dsh.

**Move to another computer**: `state.json` has no absolute paths except the working folders you set for Bots and groups, but dsh's `storages/workspace.json` and the Session folder names contain the workspace's absolute path. If the path is the same on the new computer, copy the folder. If it is different (another user name or system), it is not yet tested whether dsh finds the old Sessions.

**dsh Web and Desktop at the same time**: by default both use the same `~/.dsh`. The dsh that loads the team first takes `bot/state.lock` and can change the team. The other one is read-only: it shows the team and follows changes to the file, but refuses changes (`bot/read-only`, "open in another dsh"), and its Bots cannot start new Sessions. When the first one exits, the other one takes over on its next request. To change the team from both at once, give one of them a different `DSH_HOME` (two separate teams).

## Development

You need Node 24, pnpm and a deepseek-harness checkout with its dependencies installed, next to this repository (`../deepseek-harness`, or set `DSH_HARNESS`). The Desktop test bench also needs `xvfb-run` and `ffmpeg`. Web screenshots need Chrome or Chromium (`CHROME_BIN`; by default `google-chrome` or `chromium`).

```sh
npm ci                                   # esbuild, for the client build
npm run build                            # src/client → client.js
npm test                                 # unit tests
npm run lint                             # oxlint from the dsh repository (.oxlintrc.json)
dev/bench.sh dev 3100 8800 start         # Web test bench: mock model + dsh Web, data in ../.dsh-test-dev
dev/desktop-linux/desktop.sh dev start   # Desktop test bench: mock model + dsh Desktop in Xvfb
CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh smoke 3101 8801 reset && node dev/smoke.mjs smoke 3101
dev/check.sh                             # all checks (see below)
```

- `client.js` is built from `src/client/` and committed, so `link:` and Git installs need no build. Do not edit `client.js` by hand; `npm test` checks that it matches the source. After a change in `src/client/`, run `npm run build` and reload the page. After a change in `index.js` or `src/host/`, restart dsh.
- **Web test bench** `dev/bench.sh <name> <web port> <mock port> [start|stop|reset|status]`: the profile links this plugin and the channels and canvas plugins beside it (`../omni-channels-dsh`, `../omni-canvas-dsh`); a scripted mock model (`dev/mock-llm.mjs`, no real tokens; its commands are listed at the top of the file) and a dsh Web server. Data goes in `../.dsh-test-<name>/`; `reset` clears the team and Sessions first. The login address with its token is in `../.dsh-test-<name>/web.log`.
- **Desktop test bench** `dev/desktop-linux/desktop.sh <name> [start|stop|reset|status]`: dsh does not run Desktop on Linux; `launch.mts` runs the unpackaged Desktop in Xvfb. The first start downloads Electron and a Linux runtime (a few minutes). `start` returns when the team shows in a 1400×860 window.
- **All checks** `dev/check.sh [--skip steps] [--only steps] [--out dir]`: `unit`, `build`, `lint` (each in this plugin and in the channels and canvas plugins), `smoke`, `web` (screenshots of the sidebar, a chat, a group, Bot settings, the Bots page and group settings) and `desktop` (the same screenshots, then the Bot browser checks). It stops everything it started. On failure it names the step and its log and exits non-zero. A full run takes about 3 minutes after the first download.
- **Ports**: every script takes `SLOT=n` (0-9, default 0) so that several people or sessions on one machine do not collide: Web bench `31n0` and mock `88n0`, smoke `31n1` and `88n1`, Desktop mock `88n2`, and so on. A Desktop uses about 1 GB of memory; stop it when you are done.
- **Real models** (these cost tokens): `dev/steward-eval.mjs` sends hand-written conversation endings through the context steward's own prompt to an OpenAI-compatible route (or, with `--api messages`, an Anthropic Messages route such as DeepSeek's official one) and checks each decision. `dev/llm-tap.mjs <port> <upstream base URL> <log.jsonl> [body dir]` is a logging pass-through for either format: point a provider's `baseURL` at it, and it writes one JSON line per call (steward, checkpoint, handoff note or main turn, the Bot's name, token usage, the answer, and where the request first differs from the same Bot's previous one, which is what a provider's cache can reuse; never headers). With a body dir it also saves every request body. Each file explains its use at the top.
- **Screenshots**: `dev/ui-shots.mjs` works for both apps (`desktop <dsh repo> <dir> <renderer port>` or `web <dsh repo> <dir> <bench name> <web port>`).
- `npm test` loads the `@deepseek-ai/*` packages from the deepseek-harness checkout, else from `dev/harness` (`npm run harness`). The channels and canvas plugins' tests also load this plugin's `index.js`, `test/fake-ctx.js` and committed `client.js` from this folder, to compose the team with their own runtimes.

## Layout

| Path | Purpose |
|---|---|
| `index.js` | Host entry: installs the `src/host/` modules in order and provides the runtime as `omniTeam` |
| `src/host/` | Host: team and storage (`roster`, `store`), tools (`tools`), turns and delivery (`turns`, `delivery`), group chats (`groups`), chat parts, the context steward and the index (`parts`, `steward`, `chat-index`), image text (`images`), secrets (`secrets`), Bot browser (`browser`), the hooks other Omni plugins add through (`extend`), the `POST api/omni-ui` route (`channel`) |
| `src/client/` | Browser source: sidebar, chat header, transcript cells, panels and dialogs, themes, Bot browser panel, the registries other Omni plugins add to (`extend`) and the canvas slot they draw into (`canvas-slot`, `canvas-text`) |
| `client.js` | Built from `src/client/` by `scripts/build-client.mjs` (esbuild); committed |
| `web-search.js` | The `auto` search provider; independent of the team code |
| `test/` | Unit tests and fixtures |
| `dev/characters.mjs` | Builds the characters (small 3D models traced to outlines) into the `CHARACTERS` table in `src/client/characters.js` |
| `dev/` | Mock model, test benches, smoke test, Desktop scripts, real-model tools (steward evaluation, logging pass-through) |

## License

[Apache-2.0](LICENSE)
