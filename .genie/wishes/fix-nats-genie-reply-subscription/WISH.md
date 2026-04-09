---
slug: fix-nats-genie-reply-subscription
title: "Fix nats-genie provider never subscribing to omni.reply.* — agent replies silently dropped"
status: ready
priority: P0
github_issue: 340
github_duplicate: 339
---

## Problem

After PR #333 merged the new `nats-genie` provider, **agent replies are silently dropped**. End-to-end:

- ✅ Inbound: WhatsApp → Omni → NATS `omni.message.{instance}.{chat_id}` → Genie → agent SDK (works)
- ❌ Outbound: agent reply → NATS `omni.reply.{instance}.{chat_id}` → **nothing listening** → WhatsApp stays silent

Empirically verified on `dev` (commit 52e02935, 2026-04-04): a test harness subscribing directly to `omni.reply.>` receives the full agent reply after ~25s, but real WhatsApp conversations never get a reply because Omni has no subscriber for that subject.

**Severity: CRITICAL.** Every message a real user sends right now is being processed by the agent, but the reply never reaches them. This is a total outbound delivery failure for any instance using the new `nats-genie` provider.

## Root Cause

Two coupled defects in `packages/api/src/plugins/agent-dispatcher.ts`:

### Defect 1 — `onReply` callback never provided

`createNatsGenieProviderInstance()` at lines 2727-2746 constructs the provider without the `onReply` field:

```typescript
return new NatsGenieProvider(provider.id, provider.name, {
  agentName,
  natsUrl,
  instanceId: instance.id,
  prefixSenderName: instance.agentPrefixSenderName ?? true,
  // ← onReply is missing
});
```

### Defect 2 — `startReplySubscription()` never called

The subscription method exists and is correct (see `packages/core/src/providers/nats-genie-provider.ts:151-186`), but there are **zero callers** anywhere in the codebase:

```bash
$ grep -rn 'startReplySubscription' packages --include='*.ts' | grep -v dist
packages/core/src/providers/nats-genie-provider.ts:151:  async startReplySubscription(): Promise<void> {
# Zero callers.
```

And the method early-exits on `if (!this.config.onReply) return;` — so even if it were called, nothing would happen without fixing Defect 1.

The old filesystem-based `inbox-bridge.ts` (deleted in PR #333, `-535` lines) used to handle reply routing. That routing was never ported to the new provider's subscription path.

## Scope

**IN scope:**
- Wire `onReply` callback in `createNatsGenieProviderInstance` (agent-dispatcher.ts:2727-2746)
- Call `provider.startReplySubscription()` after construction
- Use the existing `sendTextMessage()` helper at `agent-dispatcher.ts:371` to deliver replies to the channel
- Verify `providerCache` (agent-dispatcher.ts:2759) still prevents duplicate subscriptions on re-resolve
- Add integration test covering the full publish-reply round-trip with a mock NATS connection

**OUT of scope:**
- Any changes to NatsGenieProvider internals (subscription logic is correct as-is)
- Changes to how Genie publishes replies (working per issue #340 empirical verification)
- #335 genie schema health check 404 (separate issue)
- #338 omni connect command typo (separate issue)

## Solution Sketch

```typescript
function createNatsGenieProviderInstance(provider: AgentProvider, instance: DispatchInstance): IAgentProvider | null {
  const schemaConfig = (
    typeof provider.schemaConfig === 'object' && provider.schemaConfig !== null ? provider.schemaConfig : {}
  ) as Record<string, unknown>;

  const agentName = typeof schemaConfig.agentName === 'string' ? schemaConfig.agentName : '';
  if (!agentName) {
    log.error('NATS Genie provider missing agentName in schemaConfig', { providerId: provider.id });
    return null;
  }

  const natsUrl = typeof schemaConfig.natsUrl === 'string' ? schemaConfig.natsUrl : 'localhost:4222';
  const channelType = instance.channelType as ChannelType;

  const natsProvider = new NatsGenieProvider(provider.id, provider.name, {
    agentName,
    natsUrl,
    instanceId: instance.id,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
    onReply: async (chatId, content, _metadata) => {
      try {
        await sendTextMessage(channelType, instance.id, chatId, content);
      } catch (error) {
        log.error('Failed to deliver agent reply', {
          chatId,
          instanceId: instance.id,
          providerId: provider.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // Fire subscription as side effect — don't block provider resolution
  natsProvider.startReplySubscription().catch((err) => {
    log.error('Failed to start NATS reply subscription', {
      instanceId: instance.id,
      providerId: provider.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return natsProvider;
}
```

Note: `providerCache` at line 2759 already caches by `${provider.id}:${instance.id}`, so `startReplySubscription()` only runs once per (provider, instance) pair. Good.

## Execution Groups

### Group 1 — Fix + Unit Test (engineer)
- Edit `packages/api/src/plugins/agent-dispatcher.ts:2727-2746` per solution sketch
- Ensure `ChannelType` is imported if not already
- Add error handling around `sendTextMessage` call — swallow + log (don't crash provider)
- Add a focused unit test that asserts `onReply` is wired and forwards content through `sendTextMessage`
- Run `bun run build` + `bunx biome check .` + `bun test` locally

### Group 2 — Integration Test (qa)
- Add a test that stands up a mock NATS connection, publishes to `omni.reply.{instance}.{chat}`, and asserts `sendTextMessage` is called with the expected args
- Verify the test fails on current `dev` (before the fix) and passes after

### Group 3 — Verification + PR (reviewer)
- Re-verify `grep -rn startReplySubscription` now shows a caller in agent-dispatcher
- Confirm no regression in existing provider tests
- Open PR to `dev` with title: `fix(api): wire nats-genie reply subscription — restores agent → WhatsApp delivery`
- Link to #340 in PR body; note that #339 should be closed as duplicate

## Acceptance Criteria

- [ ] `grep -rn 'startReplySubscription' packages --include='*.ts'` shows at least one caller outside the definition
- [ ] `grep -rn 'onReply' packages/api/src/plugins/agent-dispatcher.ts` shows the new callback
- [ ] New unit test passes: provider construction wires `onReply` and `sendTextMessage` is invoked on reply
- [ ] New integration test passes: publish to `omni.reply.{instance}.{chat}` → `sendTextMessage` called with `(channelType, instanceId, chatId, content)`
- [ ] `bun run build` clean across all packages
- [ ] `bunx biome check .` clean
- [ ] `bun test` — no new failures (record baseline pre-existing failures)
- [ ] PR opened targeting `dev` branch

## Validation Commands

```bash
cd /home/genie/workspace/agents/omni/repos/omni
bun run build
bunx biome check .
bun test packages/api/src/plugins/__tests__/agent-dispatcher*.test.ts
grep -rn 'startReplySubscription' packages --include='*.ts' | grep -v dist
```

## Risk & Blast Radius

- **Blast radius:** Only affects instances with a `nats-genie` schema provider. No other provider schemas touch this code path.
- **Rollback:** Revert the single function edit; all other provider types unaffected.
- **Data risk:** None — this is restoring a dropped reply path, not mutating data.

## References

- Issue: https://github.com/automagik-dev/omni/issues/340
- Duplicate: https://github.com/automagik-dev/omni/issues/339
- Predecessor PR (introduced bug): #333 `feat/nats-genie-provider`
- Related: #332 (tracking epic), #335 (separate health check issue)
