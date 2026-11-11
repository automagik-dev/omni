# DRAFT: chat-scoped-bots

## Settled

- **R1-1** (round 2, decision): How should the per-chat sub-bot be built? — owner picked "Extend chat threads (Recommended)"
- **R1-2** (round 2, decision): What makes a set of chats share one sub-bot? — owner picked "Explicit list (Recommended)"
- **R1-3** (round 2, decision): What does a sub-bot know about itself? — owner picked "Own notes + Omni Bot base (Recommended)"
- **R1-4** (round 2, decision): Should this design also fix the bad 30-day pending sweep? — owner picked "Separate design (Recommended)"
- **R2-1** (round 3, decision): Who can create a sub-bot (a thread with its chat set and notes)? — owner picked "Omni Bot tool + your + (Recommended)"
- **R2-2** (round 3, decision): How do automations attach to a sub-bot? — owner picked "Owned by the thread (Recommended)"
- **R2-3** (round 3, decision): Can a new sub-bot send messages on its own? — owner picked "Ask first by default (Recommended)"
- **R2-4** (round 3, decision): How is the multi-chat key built? — owner picked "One key for the whole set (Recommended)"

## Asked

_No open questions._

## Size

- **M** · raised by orchestrator · round 2

## Scope ratchet

- thread-chat-set · added by orchestrator · round 2
- multi-chat-child-key · added by orchestrator · round 2
- thread-own-instructions · added by orchestrator · round 2
- main-bot-create-thread · added by orchestrator · round 2
- automation-targets-thread-at-save · added by orchestrator · round 2
- omni-bot-describes-threads-correctly · added by orchestrator · round 2

## Councils

_None convened._

## Ledger

```ledger
{
  "settled": [
    {
      "id": "R1-1",
      "kind": "decision",
      "question": "How should the per-chat sub-bot be built?",
      "answer": "Extend chat threads (Recommended)",
      "value": "extend-threads",
      "provenance": "owner picked \"Extend chat threads (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-2",
      "kind": "decision",
      "question": "What makes a set of chats share one sub-bot?",
      "answer": "Explicit list (Recommended)",
      "value": "explicit-list",
      "provenance": "owner picked \"Explicit list (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-3",
      "kind": "decision",
      "question": "What does a sub-bot know about itself?",
      "answer": "Own notes + Omni Bot base (Recommended)",
      "value": "own-plus-base",
      "provenance": "owner picked \"Own notes + Omni Bot base (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-4",
      "kind": "decision",
      "question": "Should this design also fix the bad 30-day pending sweep?",
      "answer": "Separate design (Recommended)",
      "value": "separate",
      "provenance": "owner picked \"Separate design (Recommended)\"",
      "round": 2
    },
    {
      "id": "R2-1",
      "kind": "decision",
      "question": "Who can create a sub-bot (a thread with its chat set and notes)?",
      "answer": "Omni Bot tool + your + (Recommended)",
      "value": "bot-and-owner",
      "provenance": "owner picked \"Omni Bot tool + your + (Recommended)\"",
      "round": 3
    },
    {
      "id": "R2-2",
      "kind": "decision",
      "question": "How do automations attach to a sub-bot?",
      "answer": "Owned by the thread (Recommended)",
      "value": "owned",
      "provenance": "owner picked \"Owned by the thread (Recommended)\"",
      "round": 3
    },
    {
      "id": "R2-3",
      "kind": "decision",
      "question": "Can a new sub-bot send messages on its own?",
      "answer": "Ask first by default (Recommended)",
      "value": "ask-default",
      "provenance": "owner picked \"Ask first by default (Recommended)\"",
      "round": 3
    },
    {
      "id": "R2-4",
      "kind": "decision",
      "question": "How is the multi-chat key built?",
      "answer": "One key for the whole set (Recommended)",
      "value": "one-key",
      "provenance": "owner picked \"One key for the whole set (Recommended)\"",
      "round": 3
    }
  ],
  "asked": [],
  "size": [
    {
      "value": "M",
      "by": "orchestrator",
      "round": 2
    }
  ],
  "scopeIn": [
    {
      "item": "thread-chat-set",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "multi-chat-child-key",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "thread-own-instructions",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "main-bot-create-thread",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "automation-targets-thread-at-save",
      "by": "orchestrator",
      "round": 2
    },
    {
      "item": "omni-bot-describes-threads-correctly",
      "by": "orchestrator",
      "round": 2
    }
  ],
  "councils": [],
  "reviews": [
    {
      "verdict": "FIX-FIRST",
      "digest": "b2162be6c04787110bb094bda5f8cec74437be94efee715ca85709040d394c8a",
      "round": 3,
      "repaired": false,
      "findings": [
        "HIGH-1",
        "HIGH-2",
        "HIGH-3"
      ]
    },
    {
      "verdict": "FIX-FIRST",
      "digest": "9b9a561f9466b578a9b63be88957ac744212582b39cc302292a50c48188ed699",
      "round": 3,
      "repaired": true,
      "findings": [
        "HIGH-2"
      ]
    },
    {
      "verdict": "SHIP",
      "digest": "adcb2024607869bb8a67f58e7fa7f0888d8753bfa2807a6360f178abb1fc3c3c",
      "round": 3,
      "repaired": true,
      "findings": []
    }
  ]
}
```

## Round 1 lead (2026-11-10)

### What the owner said
- Bad experience with the Omni Bot in DSH (transcript 2026-11-10): asked for a full 30-day WhatsApp pending table;
  the bot read only chat tails, trusted `pendingOnly` (empty), listed already-resolved items with no evidence check.
- Asked for a dedicated worker for the Fin Ops group; the bot made a `worker: thread` automation and said it was
  ephemeral, not addressable, not in the sidebar; nothing appeared ("pq nao apareceu nada aqui?").
- Owner's model: a permanent sub-bot dedicated to one chat or a set of chats with the same context, created by the
  main bot, with all automations around it, inheriting identity/memory/instructions, addressable in the sidebar.
  "I will change the code."

### What the code says (scout, origin/dev 7a9db5a62)
- The bot misdescribed its own system. A `thread` worker IS a permanent per-chat DSH Session (RFC-0001), drawn in
  the sidebar under the Omni Bot, with full tools, Auto review, a `cs` child key locked to the chat, and the
  per-chat send switch (threads.js:1-14, 394-402, 433-445; omni-tree.js:9-21; subs.js:442-447). It is created on the
  chat's first event, which is why Fin Ops showed nothing: no event since 13:30.
- Missing for the owner's model: (a) one thread for several chats (record has one chatId; lookups byChat; child key
  takes one chatId although apiKeys.chatAllowlist is an array); (b) creation by the main bot (only the owner's "+"
  and automation `ensure` create threads); (c) own instructions/memory (threadInstructions is a fixed template, "You
  are not a Bot of their team"; no Omni Bot persona or memory inherited); (d) the same group on two WhatsApp lines is
  two chats with no link (chats.conversationId exists, nothing sets it).
- No Omni agent provider talks to DSH (agno, webhook, ag-ui, claude-code, a2a, nats-genie); DSH pulls Omni events
  over SSE. The bot's "add a dsh provider" proposal goes against the current direction.
- `pendingOnly` = last message not from me AND platform unread > 0; automations do not mark read; unread only drops
  when the platform's count drops or we reply. So "automations marked everything read" was also wrong: the phones
  read them.

### Assumed (say if wrong)
- A1: build on RFC-0001 threads, not a new Bot type or an Omni-side provider (decided only if Q1 agrees).
- A2: when an automation targets `worker: thread` for a chat, the thread is created at save time, so it shows in the
  sidebar at once. Small, removes the "nothing appeared" confusion.
- A3: the Omni Bot's self-description of threads is fixed in its prompt/tool docs (it told the owner false things).

### Size triage
M if Q1 = extend threads (DSH plugin + multi-chat child key in the keys API). G if it adds a new Bot type or merges
chats across instances. Splits: (1) thread groups + main-bot creation + instructions, (2) cross-line chat linking,
(3) reading quality (pending sweep), each shippable alone.

### WRS bar
Problem 15/20 (two problems, both evidenced; the reading-quality one not yet scoped). Scope 5/20 (no IN list).
Decisions 0/20. Risks 5/20 (multi-chat key widens a thread's reach: one key now reads several chats). Criteria 0/20.
Total 25.

## Round 2 lead (2026-11-10)
Settled R1-1..R1-4: extend RFC-0001 threads; explicit chat list; own notes on top of the Omni Bot base; the 30-day
sweep is a separate design. Size M.
Scope IN (ratchet): thread-chat-set (record gains chatIds[], existing threads become one-chat sets),
multi-chat-child-key, thread-own-instructions, main-bot-create-thread, automation-targets-thread-at-save (A2: a thread
named by an automation exists from save time, so it shows in the sidebar at once), omni-bot-describes-threads-correctly
(A3: the Omni Bot told the owner false things about threads; its prompt/tool docs must match threads.js).
OUT: cross-line auto-link of the same group (trigger: a second duplicate the owner trips on); Omni-side DSH provider;
full Omni Bot memory inheritance; new Bot type; the pending sweep (own brainstorm).
Risks: a multi-chat key widens one session's reach (bounded by the explicit list and the owner's send switch);
migration of existing thread records (chatId -> chatIds); duplicate dispatch when the same group on two lines is in one
set (one event per chat id, both land in the same thread: dedupe by message id).
Criteria (draft): (1) owner asks the Omni Bot "make a worker for Fin Ops on both lines + Luiza DM" and a thread with
those 3 chats appears in the sidebar at once; (2) an automation on any of the 3 chats runs in that thread; (3) the
thread's notes show in its prompt; (4) its key reads only those 3 chats; (5) sends still ask until the owner flips the
switch; (6) existing one-chat threads keep working unchanged.
WRS: Problem 20, Scope 18, Decisions 12, Risks 14, Criteria 14 = 78.
