# Vendored from DeepSeek-Bot

- Upstream: https://github.com/Fei2411/DeepSeek-Bot (`ds-bot/` directory)
- Upstream commit: 1bebe826f74e9a72cabafd3b80602b05af867b38 (main on 2026-10-23: 0.2.1 and the 0.3.0 preparation),
  merged over e13bc3419d2695a509520d850a07e63f05c34e07, the commit first vendored (0.1.7)
- License: Apache-2.0 (see `LICENSE`; upstream `NOTICE` kept alongside)
- Modified: this directory is the Omni UI for DeepSeek Harness, rebranded and reshaped from DS Bot.
  Upstream names, logos and palette are replaced.

## How upstream comes in

The directory was copied, not linked, so a merge is built: a commit with upstream's `ds-bot/` at the
vendored commit placed at `apps/omni-ui-dsh` (the merge base), a commit on it with upstream's current
`ds-bot/` there, and a real merge of that commit into Omni. Upstream's changes then merge as git
merges them, and every conflict is resolved by hand in the merge commit.

## Merged from upstream on 2026-10-23

Taken: side questions (`/btw`), group memory, the message layout settings (bubble width, flat
layout, thinking hidden by default), the running Bot's preview in the sidebar, the relay limit that
pauses a group instead of dropping calls, the editable purpose of a saved key, one right panel at a
time, phone and touch layouts, `show_view` views (charts, calculators, sandboxed views), the
`providers`, `thinking` and `feed` host modules, and the fixes for unreadable memory and secrets
files, inherited names such as `__proto__`, a stale `state.lock`, a Bot's photo path, and input
kept through a handoff.

Kept as Omni's: the package (`@automagik/omni-dsh`, Omni's version, Bun, the DSH pin), its home,
route and plugin ids (`$OMNI_HOME/ui`, `/api/omni-ui`, `omni-ui`), the brand (OmniMark, the
octopus, the palette, every "Omni" in the copy and in the Bots' prompts), the extension registry
other Omni plugins use (`extend.js`: tool cards, row badges, header buttons, endpoints), canvases,
the Tasks agent, "New conversation", Connect AI in the model menu, and the channels footer seat.
The desktop app counts as "the app" for updates and the Bot browser through `OMNI_CLIENT_ID`.
