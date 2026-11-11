# Design: Answer mode for a dedicated Omni Bot

| Field | Value |
|-------|-------|
| **Slug** | `omni-bot-answer-mode` |
| **Date** | 2026-11-11 |
| **WRS** | 100/100 |
| **Size** | G · one wish, four groups; history learning and takeover split into a second design (R4-1) (orchestrator, round 5) |

<!-- Source: a Settled id (R1-2), a council decision (P3), "reviewer HIGH-1" or "reviewer round-2 C4" for a recorded finding, or a backticked repository path that exists; other words in the cell are prose. -->

## Problem

An owner who wants a number answered for the people who write to it has no way to do it in DSH today: the one Omni Bot of a DSH manages every channel for its owner, and its chat threads work for the owner about a chat, not for the person in it. An Omni Bot needs an answer mode in which a dedicated bot owns one or more channels and gives every person who writes their own child that answers them, sandboxed, on the master's instructions, while staff can step in at any time.

## Scope

### IN

| # | Deliverable | Files changed | Source |
|---|-------------|---------------|--------|
| 1 | Several Omni Bots per DSH. The default Omni Bot manages every channel as today; a dedicated Omni Bot owns the channels handed to it. A channel's events, automations and threads belong to its owning bot only. The default bot keeps read-only sight of a handed-over channel: it can read its chats, runs no automation on it and sends nothing there | `apps/omni-channels-dsh/src/host/subscriptions.js`, `apps/omni-channels-dsh/src/host/omni-events.js`, `apps/omni-channels-dsh/src/host/grants.js`, `apps/omni-channels-dsh/src/host/omni-api.js`, `apps/omni-channels-dsh/src/client/subscriptions.js`, `apps/omni-channels-dsh/src/client/index.js`, `apps/omni-channels-dsh/src/client/omni-tree.js` | R1-2, R2-2 |
| 2 | Creating a dedicated bot and handing it channels: by the owner in the sidebar, or by the default Omni Bot's tool, which only proposes; the owner confirms before the bot exists or a channel moves | `apps/omni-channels-dsh/src/host/subscriptions.js`, `apps/omni-channels-dsh/src/host/thread-tools.js`, `apps/omni-channels-dsh/src/client/omni-tree.js` | R2-1, R3-3 |
| 3 | Answer mode on a dedicated bot: every person who writes on its channels gets a child (a chat thread, created at their first message); the child speaks to that person, on the master's instructions and model, then its own notes the master can write | `apps/omni-channels-dsh/src/host/threads.js`, `apps/omni-channels-dsh/src/host/omni-rules.js`, `apps/omni-channels-dsh/src/host/thread-tools.js` | R1-3 |
| 4 | Sandbox and tools: every child runs on DSH's read-only preset with only tools bound to its own chat (read, reply, react, media), plus the tools the owner allows on that answer bot; no shell, no file writes. Visibility is one setting per answer bot, isolated by default: an isolated child sees only its own chat; a collective child can also read the bot's other chats and a shared notes page, and still replies only in its own chat | `apps/omni-channels-dsh/src/host/thread-tools.js`, `apps/omni-channels-dsh/src/host/threads.js`, `apps/omni-channels-dsh/src/host/thread-keys.js` | R1-1, R2-4, R3-2 |
| 5 | Sending: a new child starts in training and asks staff before each send; staff switch a child to sending, the bot sets the default for new children, and the bot may optionally graduate a child by itself after N drafts approved unchanged in a row | `apps/omni-channels-dsh/src/host/thread-tools.js`, `apps/omni-channels-dsh/src/host/threads.js`, `apps/omni-channels-dsh/src/client/omni-tree.js` | R4-2 |
| 6 | Staff take-over: a message staff send into a chat from the number's own phone or linked device pauses that chat's child. Staff are recognised only by positive own-device receipt evidence (the existing owner-receipt check on the journal and canonical message in `apps/omni-channels-dsh/src/host/omni-events.js`); any message Omni sent through its API, attributed or not, never counts as staff; it resumes when staff press resume or ask the master, or by itself after 30 minutes with no staff message in that chat (the time set per answer bot) | `apps/omni-channels-dsh/src/host/omni-events.js`, `apps/omni-channels-dsh/src/host/standing-runs.js`, `apps/omni-channels-dsh/src/host/threads.js`, `apps/omni-channels-dsh/src/client/omni-tree.js` | R1-4, R2-3, R3-1 |

### OUT

- Learning a chat's history, taking on the persona of the person who answered it so far, and offering to take it over; and the Omni history backfill that needs. A second design, next (Source: R3-4, R4-1).
- Network isolation and a separate OS user for children: DSH's sandbox covers file writes only; a deployment that needs more runs its DSH as its own user or in a container (Source: `apps/omni-channels-dsh/src/host/subscriptions.js`).
- Staff take-over on a number connected through a provider API whose channel does not yet ingest staff-message echoes: there no own-device receipt exists to pause on. Trigger: that channel ingests those echoes with own-device evidence (Source: R1-4).
- Any product name or product claim: answer mode is a generic mode of an Omni Bot (Source: R1-2).

## Approach

Build on chat threads (RFC-0001 and chat-scoped-bots) instead of a new Bot kind. A thread is already a permanent Session per chat, created at the first event of a channel-wide automation, with a key locked to its chat and a tool registry where a Session's tools can be restricted with `ctx.tools.restrict` plus a guard (`apps/omni-channels-dsh/src/host/thread-tools.js`); threads keep the full list today, and restricting children is IN row 4. Answer mode changes who a thread works for: on a dedicated bot's channels each thread is a child that answers the person, takes the master's instructions through the plugin's own prompt section (the `omni-thread` section in `apps/omni-channels-dsh/src/host/threads.js`, which can include the Bot's instructions), and runs on DSH's read-only permission preset, which the plugin already applies to asks (`apps/omni-channels-dsh/src/host/subscriptions.js`).

The new machinery is ownership: today the plugin has one events bot (`eventsBotId`), and every channel's events reach it. Several Omni Bots need each channel to have one owning bot, so a channel's events, automations and children belong to exactly one bot, and the default bot only reads a handed-over channel.

Alternatives: binding each child to the master as a Bot-team task Session would give the persona through bots-dsh but makes every child count as that Bot for all team behaviour (delivery, resume), and the owner ruled out a new Bot kind. Running children as one Bot "in its chat" gives no per-person isolation. A task Session per message gives isolation but no memory.

## Simplicity Case

- **Simplest complete design:** children are chat threads; answer mode is a setting of a dedicated Omni Bot; ownership is one owning bot per channel.
- **Added machinery:** channel ownership across several Omni Bots, required by R1-2 (answer mode needs a dedicated bot while the default bot keeps managing the rest); a per-chat pause with a 30-minute timer, required by R1-4, R2-3 and R3-1; a training state per child, required by R4-2.
- **Deferred until measured:** history learning and persona takeover (second design, R4-1); per-channel visibility (trigger: an owner needs isolated and collective on one bot).
- **Complexity removed:** no new Bot kind; no thread ids in automations; one responder per channel, so no double replies; children never choose a destination chat.

## Decisions

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| 1 | Collective means shared sight, own chat | Children can know about each other where that is fine, but never write elsewhere | R1-1 |
| 2 | Answer mode needs a dedicated Omni Bot that owns its channels; the default bot still manages all others | Keeps the default behaviour unchanged and avoids mixing modes on one bot | R1-2 |
| 3 | Children speak as the master plus their own notes | One persona, customised per person | R1-3 |
| 4 | Staff reply auto-pauses the child in that chat | Staff can step in from the phone without touching DSH | R1-4 |
| 5 | Dedicated bots are made by the owner in the sidebar or proposed by the default bot | Both paths the owner asked for | R2-1 |
| 6 | The default bot keeps read-only sight of a handed-over channel | Reports keep working; one responder | R2-2 |
| 7 | A paused child resumes by staff or by itself | Staff control plus a safe default | R2-3 |
| 8 | Isolated/collective is one setting per answer bot, isolated by default | Simple to explain; safe default | R2-4 |
| 9 | Auto-resume after 30 minutes of staff silence, set per bot | The owner's chosen time | R3-1 |
| 10 | Children get chat tools plus owner-allowed tools, read-only files, no shell | Sandboxed by default; the owner widens it per bot | R3-2 |
| 11 | The owner confirms a bot-made dedicated bot or a channel move | No bot moves channels by itself | R3-3 |
| 12 | Children start in training; staff flip each one, with optional auto-graduation after N approved drafts | Trust is earned per chat | R4-2 |
| 13 | History learning and takeover are a second design | Each ships alone | R4-1 |

## Risks & Assumptions

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | A stranger's message reaches a Session with tools | High | Read-only preset, tools restricted to the child's own chat plus owner-allowed ones, a guard that refuses the rest, and the child's key reaches only its chat |
| 2 | Two bots answer one chat | Medium | One owning bot per channel; the default bot is read-only on a handed-over channel |
| 3 | A staff reply is not recognised (an Omni-sent message mistaken for staff, or the reverse) | Medium | Staff = positive own-device receipt evidence only (the owner-receipt check in `apps/omni-channels-dsh/src/host/omni-events.js`); Omni's API sends never count, even unattributed ones (reviewer HIGH-1); tests for a phone message, an attributed send and an unattributed API send |
| 4 | DSH's sandbox does not block network or reads | Medium | Stated in OUT; deployments isolate the process when they need it |
| 5 | The release a downstream bundle ships lacks this | Low | The wish names the minimum omni-channels-dsh and Omni release in `engines.omni` |

## Success Criteria

- [ ] A DSH can hold a default Omni Bot and a dedicated one; a channel handed to the dedicated bot sends its events to it only, and the default bot can read that channel but its automations do not fire there. **Proof:** a host test in `apps/omni-channels-dsh` with two Omni Bots and two channels.
- [ ] The default bot's tool proposes a dedicated bot and a channel move, and nothing changes until the owner confirms. **Proof:** a host test asserting no bot and no move before confirmation.
- [ ] In answer mode a first message from a new person creates a child that answers that person with the master's instructions, then its notes. **Proof:** a host test asserting the child's prompt order and that its reply goes to that chat.
- [ ] A child runs on the read-only preset and is refused any tool outside its chat tools and the bot's allowed tools; it can never send to another chat. **Proof:** host tests for the preset, a refused shell call, and a refused send to a second chat.
- [ ] Isolated children cannot read other chats; collective children can read them and still reply only in their own. **Proof:** host tests for both settings.
- [ ] A new child asks before each send; staff switching it to sending removes the ask; with auto-graduation on, N approved unchanged drafts switch it. **Proof:** host tests for the three paths.
- [ ] A staff message from the phone (own-device receipt) pauses that chat's child; a message Omni sent through its API, attributed or not, does not; the child resumes on staff resume and after 30 minutes of staff silence. **Proof:** host tests with a fake clock.
- [ ] Existing setups with one Omni Bot keep working unchanged. **Proof:** the full plugin suite passes with no change to one-bot fixtures.

## Next Step

After an independent design review returns SHIP, persist the evidence below and verify its content digest before running `wish`.

<!-- genie-design-review:start -->
## Design Review Evidence

- **Verdict:** SHIP
- **Reviewed content SHA-256:** `95b8790c8e0f7e89003d30a23977e24a423f03469b40dbfbebda261784bd4c67`
- **Reviewer:** codex t5h7 (Omni Reviewer t3q7)
- **Reviewed at:** 2026-11-11T19:41:45.000Z
<!-- genie-design-review:end -->
