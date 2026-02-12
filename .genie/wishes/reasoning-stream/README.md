# Reasoning Stream — Feature Index

This feature was split into two wishes per council review (2025-02-11).

## Wishes

| Wish | Status | Scope |
|------|--------|-------|
| [`stream-plumbing`](../stream-plumbing/wish.md) | READY | Types, client routing, channel-sdk interface, provider AsyncGenerator |
| [`stream-telegram`](../stream-telegram/wish.md) | READY (depends on plumbing) | TelegramStreamSender, dispatcher integration, integration tests |

## Execution Order

```
stream-plumbing  ──→  stream-telegram
```

## Artifacts

- Design: `../../.genie/brainstorms/reasoning-stream/design.md`
- User Story: `/home/genie/workspace/cezao/user-stories/omni-telegram-reasoning-stream.md`
- Original monolithic wish: `wish-v1-monolithic.md` (archived)
