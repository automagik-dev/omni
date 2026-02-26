# Plan: Claude Code Provider — Streaming + Tool Call Capture

## Objetivo

Adicionar suporte a streaming real e captura de tool calls no provider Claude Code do Omni v2, usando técnicas extraídas do claude-relay e a infraestrutura de streaming que já existe no Omni.

## Contexto

### O que temos hoje
- `ClaudeCodeClient.run()` — one-shot: itera o SDK inteiro, só captura `result` no final
- `ClaudeCodeClient.stream()` — existe mas rudimentar: só captura `assistant` (text) e `result`
- `ClaudeCodeAgentProvider` — só implementa `trigger()`, não implementa `triggerStream()`
- **Nenhuma visibilidade** de tool calls, thinking, ou progresso intermediário
- A infraestrutura de streaming já funciona no dispatcher (`dispatchViaStreamingProvider()`) e nos channels (WhatsApp, Telegram, Slack já têm `StreamSender`)

### O que o SDK expõe
O SDK emite mensagens ricas via `SDKMessage` (union type):
- `stream_event` (`SDKPartialAssistantMessage`) — deltas de Anthropic raw: `content_block_start/delta/stop` com `tool_use`, `thinking`, `text`
- `tool_progress` (`SDKToolProgressMessage`) — progresso de tool com `tool_name`, `tool_use_id`, `elapsed_time_seconds`
- `tool_use_summary` (`SDKToolUseSummaryMessage`) — resumo após tool completar
- `assistant` (`SDKAssistantMessage`) — mensagem completa com `BetaMessage.content[]` (text + tool_use + tool_result blocks)
- `user` (`SDKUserMessage`) — mensagens do usuário (incluem `tool_use_result`)
- `result` (`SDKResultMessage`) — resultado final com métricas (cost, tokens, duration)
- `system.status` — status como `compacting`

### Infra de streaming existente no Omni
- `StreamDelta` type: `{ phase: 'thinking' | 'content' | 'final' | 'error' }`
- `IAgentProvider.triggerStream?()` — método opcional que yields `StreamDelta`
- `StreamSender` interface nos channels: `onThinkingDelta`, `onContentDelta`, `onFinal`, `onError`
- Dispatcher: `dispatchViaStreamingProvider()` + `routeStreamDelta()` + `consumeStream()`
- DB: `instance.agentStreamMode` (boolean), `provider.supportsStreaming` (boolean)

## Implementação

### Fase 1: `triggerStream()` no ClaudeCodeAgentProvider

**Arquivo:** `packages/core/src/providers/claude-code-provider.ts`

Adicionar método `triggerStream()` que:
1. Prepara o prompt igual ao `trigger()` (sender prefix, context messages)
2. Resolve sessão via `SessionStorage` (mesma lógica de TTL)
3. Chama `query()` do SDK com `includePartialMessages: true`
4. Itera `SDKMessage` do generator e mapeia para `StreamDelta`:

```typescript
async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
  // ... setup igual ao trigger() ...

  const blocks: Map<number, ToolBlock> = new Map();
  let accumulatedText = '';
  let accumulatedThinking = '';
  let thinkingStartMs = 0;

  for await (const message of query({ prompt, options })) {
    // 1. stream_event → conteúdo progressivo
    if (message.type === 'stream_event') {
      const evt = message.event;

      if (evt.type === 'content_block_start') {
        if (evt.content_block.type === 'thinking') {
          thinkingStartMs = Date.now();
        }
        if (evt.content_block.type === 'tool_use') {
          blocks.set(evt.index, { id: evt.content_block.id, name: evt.content_block.name, inputJson: '' });
        }
      }

      if (evt.type === 'content_block_delta') {
        if (evt.delta.type === 'text_delta') {
          accumulatedText += evt.delta.text;
          yield { phase: 'content', content: accumulatedText };
        }
        if (evt.delta.type === 'thinking_delta') {
          accumulatedThinking += evt.delta.thinking;
          yield { phase: 'thinking', thinking: accumulatedThinking, thinkingElapsedMs: Date.now() - thinkingStartMs };
        }
        if (evt.delta.type === 'input_json_delta') {
          const block = blocks.get(evt.index);
          if (block) block.inputJson += evt.delta.partial_json;
        }
      }

      if (evt.type === 'content_block_stop') {
        const block = blocks.get(evt.index);
        if (block) {
          // Tool call completou — emitir como conteúdo formatado
          const input = tryParseJSON(block.inputJson);
          const toolLine = formatToolCall(block.name, input);
          accumulatedText += toolLine;
          // Opcionalmente yield tool info como content delta
        }
      }
    }

    // 2. tool_progress → append status
    if (message.type === 'tool_progress') {
      // Opcional: yield status como content
    }

    // 3. result → final
    if (message.type === 'result') {
      yield { phase: 'final', content: accumulatedText, thinking: accumulatedThinking || undefined };
      // Upsert session
    }
  }
}
```

### Fase 2: Configuração de visibilidade

**Arquivos:**
- `packages/db/src/schema.ts` — novo campo JSONB no provider ou na instance
- `packages/core/src/providers/claude-code-provider.ts` — leitura da config

Nova config no `ClaudeCodeProviderOptions`:

```typescript
export interface ClaudeCodeStreamConfig {
  /** Show tool calls in streamed output (default: false) */
  showToolCalls?: boolean;
  /** Show thinking/reasoning in streamed output (default: false) */
  showThinking?: boolean;
  /** Show tool progress updates (default: false) */
  showToolProgress?: boolean;
  /** Format for tool calls: 'compact' = "🔧 Bash: git status", 'verbose' = full args (default: 'compact') */
  toolCallFormat?: 'compact' | 'verbose';
}
```

Isso permite configurar por provider/instance se tool calls e thinking aparecem na mensagem final ou só são capturados internamente (para events/analytics).

**Onde armazenar:**
- Opção A: No `schemaConfig` JSONB do provider (campo `streamConfig`)
- Opção B: Na instance como novo campo
- **Recomendação:** No `schemaConfig` do provider (já existe e é JSONB livre) — afeta todas as instances que usam o provider. Override por instance via route ou instance config futuramente.

### Fase 3: Eventos de observabilidade (tool calls)

**Arquivo:** `packages/api/src/plugins/agent-dispatcher.ts`

Independente de streaming estar ligado ou não, capturar tool calls e emitir events:

```typescript
// Novo event type
'agent.tool.executed' → {
  instanceId, chatId, correlationId,
  toolName: 'Bash',
  toolInput: { command: 'git status' },
  durationMs: 1200,
  isError: false,
}
```

Isso vem dos `tool_progress` e `tool_use_summary` messages do SDK, ou dos `content_block_stop` + `tool_result` blocks.

**Implementação:** Hook no `triggerStream()` que emite events via callback, ou capturar na camada do dispatcher que já tem acesso ao eventBus.

### Fase 4: AbortController

**Arquivo:** `packages/core/src/providers/claude-code-client.ts`

Passar `AbortController` nas options do SDK:

```typescript
const abortController = new AbortController();

// Timeout handler
const timeout = setTimeout(() => abortController.abort(), timeoutMs);

const queryInstance = query({
  prompt: request.message,
  options: {
    ...this.buildOptions(request),
    abortController,
  },
});
```

Expor o abort no provider para que o dispatcher possa cancelar (ex: sessão expirou, usuário mandou emoji de stop).

## Arquivos a modificar

| Arquivo | Mudança |
|---------|---------|
| `packages/core/src/providers/claude-code-provider.ts` | Adicionar `triggerStream()`, stream config |
| `packages/core/src/providers/claude-code-client.ts` | Adicionar `streamRun()` generator method, AbortController |
| `packages/core/src/providers/types.ts` | Possivelmente extender `StreamDelta` com metadata de tool (ou manter separado) |
| `packages/db/src/schema.ts` | Adicionar `streamConfig` no schemaConfig type (se necessário) |
| `packages/api/src/plugins/agent-dispatcher.ts` | Ajustar factory `createClaudeCodeProvider()` para passar stream config |

## Arquivos que NÃO precisam mudar

- Channel plugins (WhatsApp, Telegram, Slack) — já têm `StreamSender` implementado
- `agent-dispatcher.ts` dispatch flow — `dispatchViaStreamingProvider()` já funciona com qualquer provider que implemente `triggerStream()`
- DB schema para `agentStreamMode` — já existe no instance

## Para ativar

1. Implementar as mudanças acima
2. No provider Claude Code: `UPDATE agent_providers SET supports_streaming = true WHERE schema = 'claude-code'`
3. Na instance: `omni instances update new-testonho --agent-stream-mode`
4. Opcionalmente configurar `streamConfig` no schemaConfig do provider

## Fora de escopo (futuro)

- **Async MessageQueue** (multi-turn na mesma query) — requer refactor maior do lifecycle
- **Rewind** — feature avançada, depende de `enableFileCheckpointing`
- **canUseTool interceptor** — modo enterprise com aprovação humana
- **Model switching runtime** — `query.setModel()` precisa de query persistente
