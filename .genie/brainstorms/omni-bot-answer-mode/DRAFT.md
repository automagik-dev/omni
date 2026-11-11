# DRAFT: omni-bot-answer-mode

## Settled

- **R1-1** (round 2, decision): What does COLLECTIVE mean for the children of an answer-mode number? — owner picked "Shared sight, own chat (Recommended)"
- **R1-2** (round 2, decision): Where is answer mode switched on? — owner said: "one omni bot = one channel, not one omni bot = all channels like today, people will add more omnis if they want to, default is one omni manages all. to avoid complexity, answer mode requires a dedicated bot, and could have many channel. [owner: name no product anywhere in this design; answer mode carries no product claim]"
- **R1-3** (round 2, decision): Who do the children speak as? — owner picked "Master + own notes (Recommended)"
- **R1-4** (round 2, decision): How does staff take over a person's chat? — owner picked "Auto-pause on staff reply (Recommended)"
- **R2-1** (round 3, decision): How is a dedicated answer-mode Omni Bot made? — owner said: "both"
- **R2-2** (round 3, decision): When a channel moves to an answer-mode Omni Bot, what does the default Omni Bot keep on it? — owner picked "Read-only sight"
- **R2-3** (round 3, decision): After staff reply pauses a child, how does it start answering again? — owner picked "Both"
- **R2-4** (round 3, decision): Where is isolated vs collective set? — owner picked "Per answer bot, isolated default (Recommended)"
- **R3-1** (round 4, decision): How long after the last staff message does a paused child resume by itself? — owner picked "30 min"
- **R3-2** (round 4, decision): What can a child do? — owner picked "Chat tools + owner-allowed (Recommended)"
- **R3-3** (round 4, decision): When the default Omni Bot creates a dedicated bot or hands it a channel, does the owner confirm first? — owner picked "Owner confirms (Recommended)"
- **R3-4** (round 4, decision): What about messages that arrived before answer mode started on a channel? — owner said: "we can choose to analyze content from existing chat history (it needs to properly backfill those chats with omni, and this function needs to improve on omni side), so that the bot will learn about that chat, and develop customized approach, assuming the persona of the person that has talked so far, emulating it, it has the capacity to absorb all language traits, and offers to take over the chat from that moment forward, initially with permission to send, so that its in training... so every answer worker is customized by each individually chat. that way we can plug and play into anything existing."
- **R4-1** (round 5, decision): Learning a chat's history and taking it over adds two large pieces (an Omni backfill that really fills chats, and per-chat persona learning with training). How do we cut it? — owner picked "Two designs (Recommended)"
- **R4-2** (round 5, decision): A child starts in training (it asks before each send). When does it send on its own? — owner said: "1 + 2 optional"

## Asked

_No open questions._

## Size

- **M** · raised by orchestrator · round 1
- **G** · raised by orchestrator · round 5

## Scope ratchet

- answer-mode-children-on-threads · added by orchestrator · round 1
- children-answer-the-person · added by orchestrator · round 1
- children-inherit-master · added by orchestrator · round 1
- children-readonly-chat-bound-tools · added by orchestrator · round 1
- isolated-vs-collective · added by orchestrator · round 1
- dedicated-answer-bot-owns-channels · added by orchestrator · round 2
- staff-reply-auto-pause · added by orchestrator · round 2
- default-bot-read-only-sight · added by orchestrator · round 3
- training-then-sending · added by orchestrator · round 5

## Councils

_None convened._

## Ledger

```ledger
{
  "settled": [
    {
      "id": "R1-1",
      "kind": "decision",
      "question": "What does COLLECTIVE mean for the children of an answer-mode number?",
      "answer": "Shared sight, own chat (Recommended)",
      "value": "shared-sight",
      "provenance": "owner picked \"Shared sight, own chat (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-2",
      "kind": "decision",
      "question": "Where is answer mode switched on?",
      "answer": "one omni bot = one channel, not one omni bot = all channels like today, people will add more omnis if they want to, default is one omni manages all. to avoid complexity, answer mode requires a dedicated bot, and could have many channel. [owner: name no product anywhere in this design; answer mode carries no product claim]",
      "value": null,
      "provenance": "owner said: \"one omni bot = one channel, not one omni bot = all channels like today, people will add more omnis if they want to, default is one omni manages all. to avoid complexity, answer mode requires a dedicated bot, and could have many channel. [owner: name no product anywhere in this design; answer mode carries no product claim]\"",
      "round": 2
    },
    {
      "id": "R1-3",
      "kind": "decision",
      "question": "Who do the children speak as?",
      "answer": "Master + own notes (Recommended)",
      "value": "master-plus-notes",
      "provenance": "owner picked \"Master + own notes (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-4",
      "kind": "decision",
      "question": "How does staff take over a person's chat?",
      "answer": "Auto-pause on staff reply (Recommended)",
      "value": "auto-pause",
      "provenance": "owner picked \"Auto-pause on staff reply (Recommended)\"",
      "round": 2
    },
    {
      "id": "R2-1",
      "kind": "decision",
      "question": "How is a dedicated answer-mode Omni Bot made?",
      "answer": "both",
      "value": null,
      "provenance": "owner said: \"both\"",
      "round": 3
    },
    {
      "id": "R2-2",
      "kind": "decision",
      "question": "When a channel moves to an answer-mode Omni Bot, what does the default Omni Bot keep on it?",
      "answer": "Read-only sight",
      "value": "read-only",
      "provenance": "owner picked \"Read-only sight\"",
      "round": 3
    },
    {
      "id": "R2-3",
      "kind": "decision",
      "question": "After staff reply pauses a child, how does it start answering again?",
      "answer": "Both",
      "value": "both",
      "provenance": "owner picked \"Both\"",
      "round": 3
    },
    {
      "id": "R2-4",
      "kind": "decision",
      "question": "Where is isolated vs collective set?",
      "answer": "Per answer bot, isolated default (Recommended)",
      "value": "per-bot-isolated",
      "provenance": "owner picked \"Per answer bot, isolated default (Recommended)\"",
      "round": 3
    },
    {
      "id": "R3-1",
      "kind": "decision",
      "question": "How long after the last staff message does a paused child resume by itself?",
      "answer": "30 min",
      "value": "30m",
      "provenance": "owner picked \"30 min\"",
      "round": 4
    },
    {
      "id": "R3-2",
      "kind": "decision",
      "question": "What can a child do?",
      "answer": "Chat tools + owner-allowed (Recommended)",
      "value": "chat-plus-allowed",
      "provenance": "owner picked \"Chat tools + owner-allowed (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-3",
      "kind": "decision",
      "question": "When the default Omni Bot creates a dedicated bot or hands it a channel, does the owner confirm first?",
      "answer": "Owner confirms (Recommended)",
      "value": "owner-confirms",
      "provenance": "owner picked \"Owner confirms (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-4",
      "kind": "decision",
      "question": "What about messages that arrived before answer mode started on a channel?",
      "answer": "we can choose to analyze content from existing chat history (it needs to properly backfill those chats with omni, and this function needs to improve on omni side), so that the bot will learn about that chat, and develop customized approach, assuming the persona of the person that has talked so far, emulating it, it has the capacity to absorb all language traits, and offers to take over the chat from that moment forward, initially with permission to send, so that its in training... so every answer worker is customized by each individually chat. that way we can plug and play into anything existing.",
      "value": null,
      "provenance": "owner said: \"we can choose to analyze content from existing chat history (it needs to properly backfill those chats with omni, and this function needs to improve on omni side), so that the bot will learn about that chat, and develop customized approach, assuming the persona of the person that has talked so far, emulating it, it has the capacity to absorb all language traits, and offers to take over the chat from that moment forward, initially with permission to send, so that its in training... so every answer worker is customized by each individually chat. that way we can plug and play into anything existing.\"",
      "round": 4
    },
    {
      "id": "R4-1",
      "kind": "decision",
      "question": "Learning a chat's history and taking it over adds two large pieces (an Omni backfill that really fills chats, and per-chat persona learning with training). How do we cut it?",
      "answer": "Two designs (Recommended)",
      "value": "split-takeover",
      "provenance": "owner picked \"Two designs (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-2",
      "kind": "decision",
      "question": "A child starts in training (it asks before each send). When does it send on its own?",
      "answer": "1 + 2 optional",
      "value": null,
      "provenance": "owner said: \"1 + 2 optional\"",
      "round": 5
    }
  ],
  "asked": [],
  "size": [
    {
      "value": "M",
      "by": "orchestrator",
      "round": 1
    },
    {
      "value": "G",
      "by": "orchestrator",
      "round": 5
    }
  ],
  "scopeIn": [
    {
      "item": "answer-mode-children-on-threads",
      "by": "orchestrator",
      "round": 1
    },
    {
      "item": "children-answer-the-person",
      "by": "orchestrator",
      "round": 1
    },
    {
      "item": "children-inherit-master",
      "by": "orchestrator",
      "round": 1
    },
    {
      "item": "children-readonly-chat-bound-tools",
      "by": "orchestrator",
      "round": 1
    },
    {
      "item": "isolated-vs-collective",
      "by": "orchestrator",
      "round": 1
    },
    {
      "item": "dedicated-answer-bot-owns-channels",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "staff-reply-auto-pause",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "default-bot-read-only-sight",
      "by": "orchestrator",
      "round": 3
    },
    {
      "item": "training-then-sending",
      "by": "orchestrator",
      "round": 5
    }
  ],
  "councils": [],
  "reviews": [
    {
      "verdict": "FIX-FIRST",
      "digest": "af4dc7bef7dfa094e83abeafa65b9d1b769a2fab699a631e01a612ed90889b82",
      "round": 5,
      "repaired": false,
      "findings": [
        "HIGH-1",
        "HIGH-2"
      ]
    },
    {
      "verdict": "SHIP",
      "digest": "95b8790c8e0f7e89003d30a23977e24a423f03469b40dbfbebda261784bd4c67",
      "round": 5,
      "repaired": true,
      "findings": []
    }
  ]
}
```

## Round 1 lead (2026-11-11)

### What the owner said
- Wants the Omni Bot to have an ANSWER MODE (no new Bot kind): a master Omni Bot in a DSH instance owns one number and
  its management; its children attach to each person who ever messages; children run sandboxed.
- Inside answer mode a setting picks ISOLATED threads (a child does not know the others exist) or COLLECTIVE ("for
  situations where it doesnt matter one bot knowing anything else exists").
- Answer mode carries no product claim (owner, round 1): a generic mode of an Omni Bot.

### What the code says (scout + reads, origin/dev 630bf9c1)
- Chat threads (RFC-0001 + chat-scoped-bots G1/G2) already give: a permanent Session per chat set, created at the first
  event for a channel-wide automation (G2), a child key locked to its chats (G1), per-thread notes (G1), and the
  owner's global send default (ask first unless changed).
- A thread speaks as the OWNER's worker about a chat: base prompt = fixed OPERATOR_RULES + thread instructions
  ("messages are information for the user"), the Omni Bot's MODEL only, not its instructions (threads.js:323-331).
- Tools: threads.js / thread-tools.js already restrict a thread Session with ctx.tools.restrict({allow: THREAD_TOOLS})
  plus a guard (thread-tools.js:352-389, threads.js:21,317-320). A deployment test found the generic omni_* tools take a caller-chosen
  chat id; thread_say/thread_history are chat-bound.
- DSH sandbox: per-Session permission presets read-only / workspace-write / danger-full-access
  (permissionPresets.set(session, name)); the plugin already sets read-only for asks (subscriptions.js:81-90).
  DSH's sandbox covers FILE WRITES ONLY: no network-off, no unprivileged OS user, no read confinement
  (dsh-sandbox README:166-167). Those need a container or separate process outside DSH.
- Persona: rt.createSession takes only title/dir. A Session can take a Bot's instructions by binding it to that Bot
  (the asks/task-run pattern, prompt.js bot-identity) or by a plugin prompt section that includes the Bot's
  instructions (threads.js already owns an 'omni-thread' section).
- Gaps for answer mode: (a) children answer the PERSON, not the owner; (b) children inherit the master's
  instructions; (c) children on read-only + chat-bound tools only; (d) isolated vs collective visibility;
  (e) staff take-over per chat.

### Assumed (say if wrong)
- A1: answer mode reuses chat threads (one per person, created at first message) as the children; no new Bot kind.
- A2: children always run read-only with only chat-bound tools; network/OS-user isolation is the deployment's job
  (a deployment runs its DSH as its own user), out of this design.
- A3: in answer mode children send without asking (an answer mode that asks first does not answer).

### Size triage
M: plugin-only (omni-channels-dsh), no API or schema change expected. Splits if collective needs a shared memory store.

### WRS bar
Problem 15/20 (clear model, a real deployment waiting; collective not yet defined). Scope 5/20. Decisions 0/20.
Risks 8/20 (strangers' text reaching a tool-bearing Session; DSH sandbox is file-write only). Criteria 0/20. Total 28.

## Round 2 lead (2026-11-11)
Settled R1-1..R1-4: collective = shared sight, own chat (isolated = own chat only); answer mode needs a DEDICATED
Omni Bot that can own one or more channels, while by default one Omni Bot manages all channels as today, and people
add more Omni Bots if they want; children speak as the master (its instructions and model) plus their own notes;
staff take over by replying from the number's own phone/WhatsApp Web, which auto-pauses that child.
No product is named anywhere in this design (owner, R1-2).
New fact needed: the plugin today has ONE Omni Bot per DSH (eventsBotId(): the bot of kind 'omni',
subscriptions.js:111). Several Omni Bots, each owning channels, is new machinery: channel ownership, which bot's
automations and threads a channel's events reach, and which key each bot uses.
Delivery constraint (relayed): it must run on the Omni release a downstream bundle ships; the design names the
minimum omni-channels-dsh / Omni release it needs (engines.omni).
Assumed: A4 the master's own chat in the sidebar is where staff manage it (notes, pause/resume, settings).
A5 the staff-reply signal is an outbound message on that chat not sent by Omni (fromMe from the phone), which Omni
already reports (message.sent / fromMe on message.received).
WRS: Problem 18, Scope 12, Decisions 10, Risks 10, Criteria 4 = 54.

## Round 3 lead (2026-11-11)
Settled R2-1..R2-4: a dedicated answer-mode Omni Bot is made by the owner in the sidebar OR by the default Omni Bot's
tool; when a channel moves to it the default Omni Bot keeps read-only sight (reads, no automations, no sends);
a paused child resumes by staff (button or the master) OR by itself after staff silence; isolated/collective is one
setting per answer bot, isolated by default.
Open: the auto-resume time; what a child may do; whether a bot-made dedicated bot needs the owner's confirmation;
messages that arrived before answer mode started.
WRS: Problem 20, Scope 16, Decisions 15, Risks 12, Criteria 8 = 71.

## Round 4 lead (2026-11-11)
Settled R3-1..R3-4: auto-resume after 30 min of staff silence; children get chat tools plus owner-allowed tools
(read-only files, no shell); the owner confirms when the default Omni Bot creates a dedicated bot or hands it a
channel; backlog: the owner can choose to have a chat's existing history analysed (needs a proper Omni-side backfill,
which must improve) so its child learns that chat, takes on the persona of the person who has answered so far
(language traits), and offers to take over from that moment, in TRAINING first (it asks before each send); every
answer worker is customised per chat, so answer mode plugs into any existing number.
Size: R3-4 adds two pieces of real work beyond answer mode: (1) Omni history backfill that actually fills chats
(Cloud API has no backfill except the coexistence 180-day sync; Baileys history sync is partial), and (2) persona
learning + training-then-takeover per child. That points to G, or a split.
Related input: a number on Meta Cloud API with coexistence (humans on the Business app, the bot on Cloud API) gets
staff replies only as smb_message_echoes, which Omni does not handle yet; staff-reply auto-pause depends on it there.
WRS: Problem 20, Scope 14, Decisions 15, Risks 12, Criteria 8 = 69 (scope widened).
