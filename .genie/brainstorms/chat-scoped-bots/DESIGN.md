# Design: Chat-scoped sub-bots on Omni chat threads

| Field | Value |
|-------|-------|
| **Slug** | `chat-scoped-bots` |
| **Date** | 2026-11-10 |
| **WRS** | 100/100 |
| **Size** | M · one wish, three groups (orchestrator, round 2) |

<!-- Source: a Settled id (R1-2), a council decision (P3), "reviewer HIGH-1" or "reviewer round-2 C4" for a recorded finding, or a backticked repository path that exists; other words in the cell are prose. -->

## Problem

The owner wants a permanent sub-bot for one chat or a set of chats that share a context, for example the Fin Ops group on both WhatsApp lines plus Luiza's DM. The main bot should create it, it should show in the sidebar at once, carry its own notes, and have the automations for those chats run in it. Today a chat thread (RFC-0001) is already a permanent per-chat DSH session with tools, a chat key and a send switch. But it covers exactly one chat, carries only a fixed prompt, can be made only by the owner's "+" or by an automation's first event, and the Omni Bot described it to the owner wrongly (as ephemeral and invisible). On 2026-11-10 the owner asked for a Fin Ops worker and saw nothing appear.

## Scope

### IN

| # | Deliverable | Files changed | Source |
|---|-------------|---------------|--------|
| 1 | A thread holds a chat set: the record gains `chatIds` (existing records load as a one-chat set); lookups resolve an event's chat to the thread whose set contains it; a chat belongs to at most one thread | `apps/omni-channels-dsh/src/host/threads.js` | R1-1, R1-2 |
| 2 | One child key per thread whose chat allowlist is the thread's set: the existing child mint (today one chat, one instance/recipient lock) is extended to take the chat set, each chat keeping its own instance lock; adding or removing a chat re-issues it | `apps/omni-channels-dsh/src/host/thread-keys.js`, `packages/api/src/services/api-keys.ts`, `packages/api/src/routes/v2/keys.ts`, `packages/api/src/schemas/openapi/keys.ts` | R2-4, reviewer HIGH-1 |
| 3 | Each thread has its own notes, added to its prompt section after the fixed thread instructions; the Omni Bot base stays first | `apps/omni-channels-dsh/src/host/threads.js` | R1-3 |
| 4 | Creation: an Omni Bot tool `create_thread(chats, title, notes)` and the owner's sidebar "+" accepting several chats; both make the thread at once so it shows in the sidebar | `apps/omni-channels-dsh/src/host/thread-tools.js`, `apps/omni-channels-dsh/src/host/threads.js`, `apps/omni-channels-dsh/src/client/omni-tree.js` | R2-1 |
| 5 | Automations belong to the thread whose set holds their chats. Source policy: an automation with an explicit chat list creates its thread at save (so it appears at once); if the listed chats already sit in different threads, the save is refused and names those threads, and the owner or the Omni Bot moves chats first. A channel-wide source (`channel:<id>`) keeps today's event-time behavior: each event goes to the thread whose set holds its chat, or a new one-chat thread. The thread lists the automations whose chats it holds; deleting a thread asks what to do with them. The event bridge passes each message's external id to dispatch so a thread holding the same group on two lines runs it once | `apps/omni-channels-dsh/src/host/subscriptions.js`, `apps/omni-channels-dsh/src/host/threads.js`, `apps/omni-channels-dsh/src/host/omni-events.js` | R2-2, reviewer HIGH-2 |
| 6 | Send rule: a new thread has no send setting of its own, so it follows the owner's global default (ask first unless the owner changed it); no tool can set its send switch; only the owner's switch does, as today | `apps/omni-channels-dsh/src/host/thread-tools.js` | R2-3 |
| 7 | The Omni Bot's tool and prompt text describes threads as they are: permanent, in the sidebar, one per chat set, created by `create_thread`, by the sidebar "+", at save for an automation with an explicit chat list, or at the first event for a channel-wide automation | `apps/omni-channels-dsh/src/host/omni-rules.js`, `apps/omni-channels-dsh/src/host/subscriptions.js`, `apps/omni-channels-dsh/src/host/threads.js` | R1-1, reviewer HIGH-3 |

### OUT

- Automatic linking of the same group on two WhatsApp lines; the owner puts both chats in one set by hand. Trigger: a second duplicate group the owner trips on, or a request to link all chats (Source: R1-2).
- An Omni-side agent provider that opens DSH sessions; DSH keeps pulling Omni's events (Source: R1-1).
- A new chat-scoped Bot type in the external bots-dsh package (Source: R1-1).
- Reading the Omni Bot's full memory from a thread; the thread has its own notes on top of the base prompt (Source: R1-3).
- The 30-day pending sweep (read every message, prove an item still open before listing it, `pendingOnly` limits); it gets its own brainstorm (Source: R1-4).

## Approach

Extend RFC-0001 chat threads instead of adding a second concept. A thread is already the owner's "sub-bot" for one chat: a permanent DSH Session in the sidebar under the Omni Bot, with the full DSH and Omni tools, Auto review, a child key locked to its chat and the per-chat send switch (`apps/omni-channels-dsh/src/host/threads.js`). The change widens "one chat" to "a set of chats the owner or the Omni Bot names", adds the thread's own notes, lets the Omni Bot create one, and creates the thread when an automation with an explicit chat list is saved instead of at the first event (a channel-wide automation keeps event-time creation). Automation ownership follows the chat set, so automations keep saying `worker: thread` and need no thread id: the retired thread-with-threadId worker (`apps/omni-channels-dsh/src/host/subscriptions.js`) stays retired.

Alternatives: a new chat-scoped Bot type in bots-dsh would give a separate persona and memory, but adds a second concept beside threads and changes a package outside this repo. An Omni-side DSH provider (the Omni Bot's own proposal) reverses today's direction, where DSH pulls Omni's events over durable consumers, and is the largest change.

## Simplicity Case

- **Simplest complete design:** the existing thread record with a `chatIds` list, a `notes` field, a create tool and create-at-save for explicit-list automations (channel-wide automations keep today's event-time path). No new table, no new process, no new Bot type.
- **Added machinery:** multi-chat child keys in the keys API, needed because a thread must read every chat in its set with one key (R2-4); `apiKeys.chatAllowlist` is already an array.
- **Deferred until measured:** cross-line auto-linking of the same group (trigger above); a shared memory store for threads (trigger: the owner asks a thread to remember across sets).
- **Complexity removed:** no thread ids in automations; no second routing layer; a chat belongs to one thread only, so an event has exactly one destination.

## Decisions

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| 1 | Build on chat threads | Threads already give a permanent per-chat session in the sidebar with tools, key and send switch | R1-1 |
| 2 | Chat sets are explicit lists | Visible and simple; the same group on two lines is added by hand | R1-2 |
| 3 | Own notes on top of the Omni Bot base | Gives each sub-bot its context without coupling to bots-dsh memory | R1-3 |
| 4 | Sweep is a separate design | It is the bot's reading method, not this structure | R1-4 |
| 5 | Omni Bot tool plus the owner's "+" create threads | What the owner asked the bot to do | R2-1 |
| 6 | Automations belong to the thread of their chats | "All automations around it", without thread ids | R2-2 |
| 7 | New threads follow the owner's global send default (ask first unless he changed it) | No bot can give itself send rights | R2-3 |
| 8 | One child key per thread for the whole set | One key reaches exactly the thread's chats | R2-4 |

## Risks & Assumptions

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | A multi-chat key widens one session's reach | Medium | The allowlist is exactly the explicit set; sends follow the owner's send default and his per-thread switch; no tool changes either |
| 2 | Existing thread records hold one `chatId` | Low | Load `chatId` as `chatIds: [chatId]`; old records keep working unchanged |
| 3 | The same group on two lines in one set dispatches the same message twice | Medium | Both chat ids land in one thread; the event bridge carries the message's external id (the WhatsApp message key) into dispatch, and the thread skips a second event whose external id it already handled |
| 4 | A chat added to a second thread | Low | A chat belongs to one thread; adding it elsewhere moves it after the owner confirms |
| 5 | The 50-thread automation cap | Low | Unchanged; multi-chat sets reduce the count |

## Success Criteria

- [ ] The owner asks the Omni Bot for a worker on Fin Ops (both lines) plus Luiza's DM; one thread with those 3 chats appears in the sidebar at once. **Proof:** a host test in `apps/omni-channels-dsh` that calls `create_thread` with 3 chats and asserts the sidebar tree lists one thread with 3 chats.
- [ ] An event on any of the 3 chats runs in that thread. **Proof:** a host test dispatching events from each chat id and asserting one thread session receives all three.
- [ ] The thread's key reads only its 3 chats. **Proof:** an API test in `packages/api/src/routes/v2/__tests__/` minting a multi-chat child key and asserting a fourth chat is refused.
- [ ] Saving a `worker: thread` automation with an explicit chat list shows its thread before any event. **Proof:** a host test asserting the thread exists right after save.
- [ ] A channel-wide (`channel:<id>`) automation keeps event-time routing: no thread at save, an event goes to the thread holding its chat or a new one-chat thread. **Proof:** a host test for both cases.
- [ ] A new thread has no send setting of its own and follows the owner's global default; no tool can set it. **Proof:** a host test asserting `create_thread` ignores a send setting and the gate applies the global default.
- [ ] Existing one-chat threads keep working. **Proof:** a migration test loading an old record with `chatId`.
- [ ] The thread's notes are in its prompt, after the Omni Bot base and the fixed thread instructions. **Proof:** a host test asserting that order in the thread prompt.
- [ ] The sidebar "+" makes one thread from several picked chats. **Proof:** a client/host test of the add operation with 2 chats.
- [ ] Adding or removing a chat re-issues the key. **Proof:** host tests asserting the old key is replaced and the new allowlist matches the set after an add and after a removal.
- [ ] The thread lists the automations whose chats it holds. **Proof:** a host test asserting the list after saving two automations on its chats.
- [ ] Saving an explicit-list automation whose chats sit in two threads is refused, naming them; deleting a thread asks about its automations. **Proof:** host tests for both.

## Next Step

After an independent design review returns SHIP, persist the evidence below and verify its content digest before running `wish`.

<!-- genie-design-review:start -->
## Design Review Evidence

- **Verdict:** SHIP
- **Reviewed content SHA-256:** `adcb2024607869bb8a67f58e7fa7f0888d8753bfa2807a6360f178abb1fc3c3c`
- **Reviewer:** codex-sofia (Omni Reviewer t3q7)
- **Reviewed at:** 2026-11-10T21:30:10.000Z
<!-- genie-design-review:end -->
