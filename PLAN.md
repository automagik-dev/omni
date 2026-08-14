# Slack user-token (DM consultiva) + paridade de features

Branch `feat/889-slack-user-token` · base `dev@1ccf79f0` · issue #889

## Status: frentes A, B e C ENTREGUES

| Commit | O quê |
|---|---|
| `b3644fcc` | thread como relação de primeira classe (migration 0048) |
| `9f62d6bc` | agendamento + permalink no contrato (migration 0049) |
| `b14d8c97` | ScheduledMessageService + sweeper |
| `0d2dae44` | edit/delete/star saem do duck-typing |
| `6fb7cc81` | authMode 'user': xoxp, conversations.open, mpim, search |
| `f2647e6a` | credenciais na tabela (0050), rotas HTTP, formatação mrkdwn |
| `4c1bdf6e` | permalink, pin/star (0051), replyToMessageId resolvido |

As três decisões em aberto foram resolvidas assim: **um plugin com `authMode`**
(o transporte é o mesmo Socket Mode), **A antes de B**, e **duck-typing
consertado** junto.

Ficou fora, e é trabalho real: `sendTyping` e `sendPresenceStatus` seguem
duck-typed; não há CLI pras rotas novas; e o modo user nunca foi exercitado
contra o Slack real — só há cobertura unitária.

O texto abaixo é o plano original, mantido como registro do raciocínio.

---

## Objetivo

Duas posturas de Slack no omni:

1. **Bot** (existe hoje) — reativo, responde no canal onde é mencionado.
2. **User (xoxp)** — consultivo, opera **como o Cezar**: recebe DMs, responde, agenda, edita, abre e lê threads, cita.

Meta declarada: paridade de features do Slack no omni, com foco no modo user.

---

## Descoberta 1 — dá pra receber em tempo real, mas o transporte não é o xoxp

A Events API tem duas classes de evento. A segunda resolve o problema:

> "Workspace Events: these are the events that require a corresponding OAuth scope, and are **perspectival to a member installing your application**."
> — https://docs.slack.dev/apis/events-api/

Assinando eventos com **user scopes** (`im:history`, `mpim:history`, `channels:history`), recebemos push das DMs e canais na perspectiva do Cezar. Push real, não polling.

**Mas** o transporte continua sendo Socket Mode (app-level token `xapp`) ou HTTP endpoint. Não existe socket aberto pelo `xoxp`.

### Desenho resultante — híbrido

| Função | Token |
|---|---|
| Receber eventos | `xapp` (Socket Mode) + assinatura user-scoped |
| Agir (post/edit/react/mark) | `xoxp` — sai como o próprio Cezar |
| Buscar (`search.messages`) | `xoxp` exclusivo — bot não faz |

Como o transporte é o mesmo do modo bot, o `connection/bolt-client.ts:70` (`createSocketBoltApp`) é reaproveitável.

### Caminhos mortos (confirmados na doc)

- **RTM API** — "Granular permission Slack apps cannot use the RTM API" (https://docs.slack.dev/legacy/legacy-rtm-api/). Classic apps não podem mais ser criados.
- **`files.upload`** — sunset em 12/nov/2025. ✅ o omni já usa `files.uploadV2` (`packages/channel-slack/src/senders/media.ts:46`), que é o wrapper do caminho novo. Sem dívida.

---

## Descoberta 2 — o gargalo é o core, não o plugin

O plugin Slack é o mais completo do repo (1520 linhas, handlers/senders/components, ~2.5k linhas de teste). **O que falta está no modelo de dados.**

### Thread não existe no DB

- Não há coluna de thread em `messages` (`packages/db/src/schema.ts:1429-1560`).
- `threadId` trafega no payload (`packages/core/src/events/types.ts:227`) só pra rotear sessão `per_thread`, e **é descartado na persistência** — zero ocorrências em `message-persistence.ts`.
- Modelo previsto e morto: `chats.parentChatId` + `chatType='thread'` (`schema.ts:1247`). `inferChatType()` (`message-persistence.ts:175-180`) só olha sufixo de WhatsApp e **nunca retorna `thread`**.
- Slack **colapsa thread em reply**: `handlers/messages.ts:190` manda `replyToId = thread_ts`. Uma resposta em thread fica indistinguível de um quote do WhatsApp.
- `replyToMessageId` (uuid) existe no schema mas **nunca é escrito**.

### Matriz: o que o xoxp entrega × o que o core grava

| Feature | Slack/xoxp | Core omni |
|---|---|---|
| reply | ✅ | ✅ `replyToExternalId` + `quotedText` |
| thread (abrir/consultar) | ✅ `thread_ts`, `conversations.replies` | ❌ sem coluna |
| quote em thread vs channel | ✅ `thread_ts` + `reply_broadcast` | ❌ um campo só |
| **agendar** | ✅ `chat.scheduleMessage` | ❌ **nada**: sem coluna, tipo, capability ou método |
| editar | ✅ `chat.update` (só msg própria) | ⚠️ duck-typed `'editMessage' in plugin` (`routes/v2/messages.ts:2901`) |
| deletar | ✅ | ⚠️ idem (`:2979`) |
| permalink | ✅ `chat.getPermalink` | ❌ zero ocorrências no repo |
| pin / star | ✅ `pins.add` | ❌ `pinned` só em `ChatSettings` JSONB **a nível de chat** |
| marcar lido | ✅ `conversations.mark` | ⚠️ só `chats.unreadCount` agregado |
| search | ✅ **exclusivo xoxp** | ❌ sem capability |

### Ressalvas de API que mudam o desenho

- **`chat.update` só edita mensagem do próprio usuário** com user token. Não edita alheia.
- **`chat.scheduledMessages.list` só lista o que o mesmo token agendou.** Agendamento feito na UI é invisível → o omni precisa guardar estado próprio, não pode confiar no Slack como fonte da verdade.
- **Não existe API de quote.** O Slack renderiza por *unfurl de permalink* — comportamento do cliente, não contrato documentado. Fallback determinístico: blockquote (`>`) + permalink em texto.
- `conversations.open` usa scope user `im:write`/`channels:write` (bot usa `channels:manage` — diferente).

### Rate limits

`conversations.history`/`replies` são Tier 3 (50+/min). O corte para 1 req/min de mai/2025 **não se aplica**: apps internos são isentos (https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/).

---

## Descoberta 3 — a camada de formatação tem bugs, e já afetam o modo bot

Slack usa **mrkdwn**, não Markdown. O conversor (`packages/channel-slack/src/markdown.ts`, 93 linhas) tem furos:

1. **Não escapa `&`, `<`, `>`.** Texto contendo `<@U099>` é enviado cru e o Slack **renderiza como menção real** — pinga um humano por acidente. Mais sério da lista.
2. **Blocos de código são mangled** — as regexes varrem a string inteira sem pular fences.
3. **Itálico vira negrito** — o docstring promete `*x*` → `_x_`; o comentário nas linhas 36-41 admite que não faz.
4. `chunkMessage` corta cego a fences: split em 4000 chars pode deixar ``` desbalanceado.
5. "Lists: preserved" é ficção — mrkdwn não tem sintaxe de lista.

Caminho melhor: `components/blocks.ts` já existe; Block Kit `rich_text` suporta listas, quotes e code blocks estruturados sem string-mangling.

**Não é regressão nova — é bug vivo no modo bot.** Item próprio, independente do transporte.

---

## Frentes propostas

### A — Core (toca TODOS os canais)

- `messages`: `threadExternalId` / `threadRootMessageId`, `replyCount`, `latestReplyAt`
- Tabela `scheduled_messages` (+ capability + método no contrato)
- `messages.permalink`, `pinnedAt`/`pinnedBy`, `starred`
- `chat_participants.lastReadExternalId` (read state por membro)
- Resolver `replyToMessageId` no persistence (coluna órfã) + backfill
- Promover `editMessage`/`deleteMessage`/`starMessage`/`scheduleMessage` ao contrato `ChannelPlugin` — hoje tudo é `'x' in plugin`
- `ChannelCapabilities`: `canScheduleMessage`, `canPinMessage`, `canGetPermalink`, `canCreateThread`, `canSearchMessages`

### B — User token

- `resolveSlackTokens` (`plugin.ts:69`) ganha ramo xoxp + `authMode`
- Assinatura de eventos user-scoped no manifest (`manifest.ts:14-48`)
- `conversations.open` (não existe no repo hoje) → resolução user ID → canal DM
- `mpim` reconhecido como DM (`handlers/messages.ts:91` hoje é só `=== 'im'`)
- `search.messages`
- Corrigir `fetchHistory` (`plugin.ts:757`): se o token veio via `credentials` em vez de `slackConfig`, loga warning e não busca

### C — Formatação

- Escape de `&`/`<`/`>` antes de tudo
- Conversor fence-aware
- Migrar saída para `rich_text` blocks
- `chunkMessage` ciente de fences

---

## Decisões em aberto

1. **Um plugin com `authMode` ou dois plugins?**
   Recomendação: **um plugin**. Eu tinha proposto dois na premissa de que o modo user seria pull; a premissa caiu — o transporte é o mesmo Socket Mode. Muda o client de escrita, não a máquina de eventos.

2. **Ordem A → B ou B → A?**
   Recomendação: **A antes**, ou ao menos a migration de thread. Fazendo B primeiro gravamos thread como reply e precisamos de backfill depois.

3. **Consertar o duck-typing agora?**
   Recomendação: **sim, junto de A.** Adicionar schedule/pin/permalink por `'x' in plugin` multiplica a dívida em vez de pagá-la.

---

## Pendências operacionais

- Sem número de issue — convenção do repo é `omni-feat-NNN-slug` (33 worktrees seguem). Abrir issue e renomear branch/dir.
- Escopo de credencial: `xoxp` é vinculado a uma pessoa e morre com a conta. Decidir onde vive (hoje as colunas Slack em `instances` são sealadas — `packages/api/src/services/instances.ts:74-76`).

## Fontes

- https://docs.slack.dev/apis/events-api/
- https://docs.slack.dev/apis/events-api/using-socket-mode
- https://docs.slack.dev/legacy/legacy-rtm-api/
- https://docs.slack.dev/apis/web-api/rate-limits/
- https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/
- https://docs.slack.dev/reference/methods/files.upload/
- https://docs.slack.dev/messaging/formatting-message-text/
