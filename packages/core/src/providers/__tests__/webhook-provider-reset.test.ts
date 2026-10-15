/**
 * WebhookAgentProvider.resetSession — the trash emoji on a webhook provider.
 *
 * The silence this fixes, traced on a live Telegram instance (2026-10-13):
 *
 *   1. user sends 🗑️
 *   2. `agent-dispatcher` guard drops it — "Skipping trash emoji message
 *      (session-cleaner handles this)" — so the agent never sees it
 *   3. `session-cleaner` looks for `agentProvider.resetSession`, does not find it
 *      on a webhook provider, and falls through to its Agno-only branch
 *   4. that throws "Session clearing not supported for webhook providers", which
 *      is in the cleaner's own `skippableErrors` list → logged at debug → return
 *
 * Net effect: nothing happens, no error surfaces, and the user is not told. The
 * session stays exactly as it was.
 */

import { describe, expect, it, mock } from 'bun:test';
import { WebhookAgentProvider } from '../webhook-provider';

type Captured = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function montar(opts: { status?: number } = {}) {
  const chamadas: Captured[] = [];
  const fetchFalso = mock(async (url: string, init: RequestInit) => {
    chamadas.push({
      url,
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    return new Response('{}', {
      status: opts.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;

  const provider = new WebhookAgentProvider('p1', 'test', {
    webhookUrl: 'https://agent.example/omni/webhook',
    mode: 'round-trip',
    apiKey: 'k',
    retries: 0,
  } as never);
  return { provider, chamadas };
}

describe('WebhookAgentProvider.resetSession', () => {
  it('exists — session-cleaner probes for it before giving up', () => {
    const { provider } = montar();
    expect(typeof provider.resetSession).toBe('function');
  });

  it('posts session.reset to the same webhook, carrying the session key', async () => {
    const { provider, chamadas } = montar();
    await provider.resetSession('sess-1', 'chat-9', 'inst-7');

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe('https://agent.example/omni/webhook');
    const corpo = chamadas[0].body as {
      event: { type: string };
      session: { key: string };
      chat: { id: string };
      instance: { id: string };
    };
    expect(corpo.event.type).toBe('session.reset');
    expect(corpo.session.key).toBe('sess-1');
    expect(corpo.chat.id).toBe('chat-9');
    expect(corpo.instance.id).toBe('inst-7');
  });

  it('carries no text — a reset is not a message, and must not be answered as one', async () => {
    const { provider, chamadas } = montar();
    await provider.resetSession('sess-1', 'chat-9');
    const corpo = chamadas[0].body as { content: { text?: string } };
    expect(corpo.content.text).toBeUndefined();
  });

  it('falls back to the session key when no chatId is given', async () => {
    const { provider, chamadas } = montar();
    await provider.resetSession('sess-only');
    const corpo = chamadas[0].body as { chat: { id: string }; session: { key: string } };
    expect(corpo.chat.id).toBe('sess-only');
    expect(corpo.session.key).toBe('sess-only');
  });

  it('propagates failure — the cleaner must not confirm a reset that did not happen', async () => {
    const { provider } = montar({ status: 500 });
    await expect(provider.resetSession('sess-1', 'chat-9')).rejects.toThrow();
  });
});
