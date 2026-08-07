# Slack como postura consultiva: user token, thread de primeira classe e agendamento

Closes #889 · 13 commits · 45 arquivos · +3500/−96 · 4 migrations

## Por que

O `channel-slack` só sabia agir **como bot**: reativo, respondendo onde é mencionado, enxergando apenas o que o bot enxerga. O objetivo aqui é uma segunda postura — **agir como a pessoa** (`xoxp`), abrindo DM, lendo o workspace pela ótica dela e usando `search.messages`, que bot token nenhum consegue chamar.

Ao abrir o capô, o gargalo não era o plugin — que já é o mais completo do repo — e sim o **core**. Metade desta PR é isso.

## A descoberta que definiu o desenho

Dá pra receber push com identidade de usuário, mas **não com o `xoxp`**. A Events API tem os *Workspace Events*, que são ["perspectival to a member installing your application"](https://docs.slack.dev/apis/events-api/): assinando com user scopes (`im:history`, `mpim:history`, …), o app vê o workspace pela ótica daquela pessoa.

O **transporte não muda**: RTM está fechada para apps granulares e Socket Mode exige app-level token. Continua Socket Mode ou HTTP receiver; muda o ponto de vista.

Por isso é **um plugin com `authMode`**, não dois: a máquina de eventos é a mesma, só o cliente de escrita troca.

## Core (toca todos os canais)

### Thread virou relação de primeira classe — `0048`

Não havia representação de thread. O `threadId` viajava no payload só para rotear sessão `per_thread` e **era descartado na persistência**. O único caminho modelado (`chats.parent_chat_id` + `chat_type='thread'`) é código morto: `inferChatType()` só inspeciona sufixo de JID do WhatsApp.

Dano prático: o Slack mandava `replyToId = thread_ts`, então **uma resposta em thread ficava indistinguível de um quote do WhatsApp** depois de gravada.

Reply aponta para UMA mensagem; thread é uma sub-conversa. Relações diferentes, colunas diferentes. `is_thread_broadcast` carrega o `reply_broadcast` do Slack — postado NA thread e espelhado no canal — e é ortogonal ao `thread_ts`, por isso coluna própria.

Sem backfill: participação em thread nunca foi registrada e não dá para reconstruir. `hasBotRepliedInThread` ganhou o branch novo mantendo os antigos, para o histórico seguir funcionando.

### Agendamento — `0049`

Dois modos, escolhidos pela capability `canScheduleMessage`:

- **`platform`** — o canal agenda nativo (`chat.scheduleMessage`); a entrega sobrevive ao omni estar fora do ar
- **`local`** — o omni segura e o sweeper envia

A linha existe **mesmo no modo platform**, deliberadamente: o `chat.scheduledMessages.list` do Slack só devolve o que foi agendado pelo MESMO token, então a plataforma não pode ser fonte da verdade sobre o que está pendente.

O sweeper enumera tenants ativos (`enumerateActiveWorkTenants`, ADR-0008) e usa `FOR UPDATE SKIP LOCKED` — ticks sobrepostos não disparam a mesma linha duas vezes.

### Permalink, pin/star, `replyToMessageId` — `0051`

`reply_to_message_id` existia no schema desde a `0000` e **nunca foi escrito uma vez**; os dois helpers que o resolveriam também não tinham chamador. Pin/star por mensagem não existia (o `pinned` do `ChatSettings` fixa a *conversa*). Permalink é resolvido preguiçosamente — é uma chamada de API por mensagem e quase nenhuma é linkada.

### Contrato de canal

`editMessage`/`deleteMessage`/`starMessage`/`sendPresenceStatus` saíram do `'x' in plugin` e entraram no `ChannelPlugin`. Ao unificar, apareceu que **o contrato estava mudo e os casts inline é que estavam certos**: `starMessage` e `deleteMessage` têm um parâmetro `fromMe` que nenhuma declaração central tinha. Escrever só o que o contrato sugeria teria quebrado star/delete no WhatsApp.

## User token — `0050`

`authMode: 'bot' | 'user'`. O `BoltConnection` ganha `actingClient`: em modo bot é o mesmo cliente; em modo user é um cliente `xoxp`. O `client` do bot **fica** — o Bolt autentica o socket com ele e é fallback para chamadas sem escopo de usuário.

- **`conversations.open`** não existia em lugar nenhum do repo. Sem ele o plugin só respondia DM que chegava, nunca iniciava uma — a diferença entre bot reativo e agente consultivo.
- **`mpim` reconhecido**, com armadilha: `isDm` passou a cobrir `im` e `mpim`, mas `buildEnrichedPayload` derivava `isGroup: !isDm`, o que marcaria um DM de **várias** pessoas como 1:1. Daí `isMpim` separado. Na conta usada nos testes: **127 ims e 72 mpims** — 72 conversas que antes eram classificadas como canal.
- **`search.messages`**, exclusivo de user token.

Guardas: `authMode: 'user'` sem `userToken` falha alto (senão toda ação sairia como bot em silêncio); token sem prefixo `xoxp-` é recusado; `searchMessages` em modo bot **lança** em vez de devolver lista vazia, que seria lida como "nada encontrado".

## Formatação (bug vivo, já afetava o modo bot)

O conversor de mrkdwn **não escapava `&`, `<`, `>`**. Um texto contendo `<@U099>` era enviado cru e o Slack **renderizava como menção real**, pingando alguém sem relação com o assunto.

Também: a conversão varria blocos de código (`**kwargs` de um exemplo Python virava `*kwargs`), itálico markdown virava **negrito** no Slack, e o `chunkMessage` cortava fences deixando ``` desbalanceado.

## Um bug que só apareceu rodando de verdade

Postando com user token, a mensagem volta com `user` = o humano **mas também com `bot_id`** (o do app). O que o plugin posta é filtrado por isso — sem loop de eco. Mas uma mensagem que **a pessoa digita** não tem `bot_id`, e o auto-filtro comparava só com o `botUserId`, que vem do token de bot e nunca bate com o humano.

Consequência: numa DM entre duas pessoas, o dono digita e o agente trata como inbound, podendo **responder em nome dele**. Não é loop — é o agente falando por cima do próprio dono.

## Dois gates de governança mudaram o desenho

1. Eu tinha posto `tenant_id` denormalizado em `scheduled_messages`, o que arrastou a tabela para o manifesto histórico das 29 e quebrou os gates do G0/migration 0041. A precedente do repo para tabela nova é `whatsapp_flow_keys`: tenancy deriva via `instance_id` e a tabela fica **fora do manifesto por construção**.
2. O ratchet do db-access proíbe crescer o débito de acesso não-escopado, e o sweeper varria globalmente. Levantar o teto seria burlar o gate — então o sweeper passou a enumerar tenants.

## HTTP mode era inalcançável pela API

Descoberto subindo o servidor de verdade, depois de tudo acima passar no typecheck e na suíte: `profileMetadata` não estava no `updateInstanceSchema` (PATCH devolvia 200 e o zod descartava), e o connect montava as options só dos tokens — quem lia metadata era o caminho de **restart**. Resultado: dava para configurar `mode: 'http'`, o banco guardava certo, e a instância nunca conectava por ele.

Os dois são *silent-success*: nada lança, nada loga, o estado é que fica errado. Tem teste de regressão que falha 3/5 se os fixes forem revertidos.

## Validação

**Contra o Slack real**, com token de usuário:

- **escapamento confirmado morto em produção** — `<@U…>` armazenado como `&lt;@…&gt;`, nenhum ping; `<!channel>` idem; `**kwargs` intacto dentro de bloco de código
- `getPermalink` · thread reply · `reply_broadcast` (com `subtype: thread_broadcast`, provando que a coluna mapeia distinção real) · `conversations.replies` · `reactions.add` · `scheduleMessage`→`list`→`delete` · `search.messages` · `conversations.open` idempotente

**Migrations** rodadas do zero num Postgres 18 descartável: 52/52; colunas, defaults, índices e FK cascade verificados no banco; as 4 reaplicadas com `ON_ERROR_STOP=1` — idempotentes de fato.

**Servidor**: o omni deste branch sobe com a instância Slack em `authMode: user` + `mode: http`, com `actingUserId` resolvido e o receiver HTTP no ar.

**Suíte**: typecheck 23/23 · biome limpo · 979 testes em `channel-slack`/`channel-sdk`/`db` verdes (as falhas restantes na `api` são os testes de MinIO, que sobem container Docker).

### Entrega inbound, ponta a ponta

O omni deste branch rodando, recebendo pela Request URL e persistindo:

```
messages=63 · chats=9 · events=63
chat_types: dm, group
Received · from U08JN9LGYQN · chatId C0B9DQJG3FD
```

São 9 conversas e 63 mensagens de canais onde o BOT NÃO ESTÁ — a perspectiva
de usuário funcionando, que é o objetivo do issue.

Três confirmações que só o banco podia dar:

- **`0` mensagens do próprio usuário autorizado persistidas**, apesar de ele
  ter digitado durante o teste. O evento chegou e o `actingUserId` filtrou —
  sem esse fix, o agente trataria a fala do dono como inbound e responderia
  por cima dele.
- **8 mensagens com `thread_external_id` preenchido** — a coluna da `0048`
  recebendo dado real, o que antes era colapsado em `replyToExternalId`.
- `chat_types: dm, group` — a classificação de mpim separando corretamente.

## Superfície nova

**Migrations** `0048` `0049` `0050` `0051` · **Rotas** `/scheduled-messages` (CRUD), `/slack/dm/open`, `/slack/search`, `GET /messages/:id/permalink` · **CLI** `omni schedule send|list|get|cancel`, `omni slack dm|search` · **Capabilities** `canScheduleMessage`, `maxScheduleAheadMs`, `canGetPermalink`, `canPinMessage`, `canSearchMessages`

## Notas de revisão

- `canSearchMessages` fica `false`: `ChannelCapabilities` é estático no plugin, não por instância, e declarar `true` prometeria busca também para instâncias em modo bot
- Não existe API de quote no Slack — o card é *unfurl* de permalink, comportamento de cliente e não contrato. O fallback determinístico é blockquote + permalink
- `scheduleTextMessage` **não** faz chunking: chunk viraria várias mensagens agendadas com handles separados e um cancelamento poderia disparar pela metade
- `post_at` vai em segundos inteiros, com teste travando (passar ms agendaria para daqui ~55 mil anos)
