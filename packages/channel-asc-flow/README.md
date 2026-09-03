# @omni/channel-asc-flow

ASC platform **Flow** channel. The conversation lives inside a flow on the ASC
platform: the flow calls Omni, and Omni answers through the platform's REST API
(`/rest/v2`).

```
WhatsApp → ASC (Flow) → api_rest node → Omni → agent
         → callbackFlowMsg (the bubbles BEFORE the last one, pushed)
         → the last bubble comes back in the api_rest RESPONSE BODY
         → transferirHumano (when the turn hands off)
```

The `api_rest` node consumes the **HTTP response body** and maps it into flow
variables through its `store`. In async mode it re-calls this endpoint until
`async_condition` over that body holds. So the channel is a **poll**, not a
push: the turn is state here, and each call answers JSON.

## Not `@omni/channel-asc`

| | `channel-asc` | `channel-asc-flow` (this) |
|---|---|---|
| Talks to | `apigw.ascbrazil.com.br` (API Gateway) | the platform (`/rest/v2`) |
| Model | BSP direct — a WhatsApp Cloud API mirror | integration via the platform's Flow |
| Inbound | Meta-format webhooks | the flow's `api_rest` node calls us |
| Outbound | `POST /api/v1/messages` (Graph shape) | the poll response body + `callbackFlowMsg` |
| `ChannelType` | `asc` | `asc-flow` |

Both can exist side by side; they share no code and no configuration.

## Configuration

| Field | Required | Notes |
|---|---|---|
| `ascFlowBaseUrl` | no | default `https://sac-notredame.ascbrazil.com.br`; `/rest/v2` is appended when absent |
| `ascFlowLogin` | yes | `/authuser` login |
| `ascFlowChave` | yes | `/authuser` chave — **secret**, redacted from API responses |
| `ascFlowHandoffServico` | no | `cod_servico` for `/transferirHumano` (the destination queue) |
| `ascFlowInteractiveViaMensagem` | no | default `true` — deliver interactive turns through `POST /mensagem` (real buttons/list); `false` keeps the numbered text in `resposta` |
| `webhookVerifyToken` | no | shared secret the flow may echo as `?token=` or `x-webhook-token` |

## Inbound contract

The flow's `api_rest` node has a free-text body, so the field names are **our**
contract:

```json
POST /api/v2/channels/asc-flow/{instanceId}/webhook
{ "codAtendimento": "12345", "chatInput": "quero marcar consulta", "phone": "5511999999999" }
```

`cod_atendimento` / `message` / `telefone` are accepted as aliases. An optional
`messageId` (alias `idMensagem`) is used for dedupe when the flow supplies one.

### Inbound media

`chatInput` is `{#MENSAGEM}`, a **string** — so when the beneficiary sends
audio, an image or a document, the flow hands us the platform's **file name**,
never the content:

```
1820260901wamid.HBgMNTU1MTk3Mjg1ODI5…FDQgA.ogg     audio
1820260901wamid.HBgMNTU1MTk3Mjg1ODI5…RjNgA.jpg     image
```

Shape: `<cod_conta><YYYYMMDD>wamid.<id>.<ext>`. Published as text, the agent
reads it as a sentence and answers nonsense (measured 01/09 on the live number).

So an input matching that shape — and *only* that shape — triggers
`GET /atendimento?codigo_atendimento={cod}`, whose `mensagens` carry the bytes
inline:

```json
{ "tip_msg": "AUDIO", "boleano_entrante": "1",
  "descricao_msg": "1820260901wamid.….ogg",
  "content-type": "audio/ogg; codecs=opus",
  "base64_arquivo": "T2dnUwACAAAA…",
  "url_arquivo": "https://…/download-file/<uuid>" }
```

The most recent **inbound** message whose `descricao_msg` equals the name we
were handed wins. Its base64 is preferred over `url_arquivo` (no second
authenticated round trip), size-checked with `createDownloadGuard` (50 MB),
stored through the SDK media backend, and emitted as a real media
`message.received` — `content.type` (`audio` / `image` / `video` / `document`,
from the `content-type` family), `content.mimeType`, and `content.localPath`,
which persistence writes to `messages.mediaLocalPath` and the media processor
consumes to transcribe / describe / extract.

Two things this deliberately protects:

- **Plain text pays nothing.** The atendimento body is large (63 KB measured on
  a ticket with one audio and one image, because every base64 rides along), so
  it is fetched only for a name-shaped `chatInput`.
- **A failed resolution never wedges the turn.** Platform down, message not
  there yet, oversized, empty base64 → a `warn` and a short PT-BR text
  (`[o beneficiário enviou um áudio, mas não foi possível ler o conteúdo]`)
  instead of the raw file name. The POLL contract is unchanged.

## Response contract (POLL)

Always HTTP `200`, always JSON. Three states, keyed by `codAtendimento`:

| State | Body |
|---|---|
| 1st call for a turn (published to the agent) | `{"pronto":0}` |
| re-call while the agent is running | `{"pronto":0}` |
| body unprocessable (no `chatInput`, bad JSON, oversized) | `{"pronto":0}` |
| the agent answered | `{"pronto":1,"resposta":"…","hand_off":"nao","bolhas":["…"]}` |

The `pronto:1` body may also carry `fila_vq` / `motivo_transf_vq` (handoff only)
and `ura_opcoes` / `forcar_botoes` (when the last bubble has options). Reading
the answer **clears the turn**: the same text on the next call is a new turn.

### What to configure on the `api_rest` node

| Field | Value |
|---|---|
| URL | `POST {omniBaseUrl}/api/v2/channels/asc-flow/{instanceId}/webhook` |
| Body | `{"codAtendimento":"{#cod_atendimento}","chatInput":"{#chatInput}","phone":"{#telefone}"}` |
| API Assíncrona | `Sim` |
| `async_condition` | `{#BODY.pronto} = 1` |
| Timeout | `180` (the dropdown's ceiling) |
| `store` | `resposta` ← `{#BODY.resposta}`, `hand_off` ← `{#BODY.hand_off}` |

A non-200 would stall the node instead of letting it poll again, which is why
even an unprocessable body answers `200` with `{"pronto":0}`.

### Dedupe is ON by default

With `API Assíncrona = Sim`, the `api_rest` node **re-POSTs the same body every
~2s** while it waits for `async_condition` to hold. Measured live
against the ASC emulator (flow #220): **one user message → ~22 POSTs**, each
published as a fresh `message.received`, and the dispatcher fired the agent with
`messageCount: 3` for a single turn. Every extra run is billed tokens and can
duplicate the reply to the beneficiary.

So the default is to deduplicate, in this order:

1. `messageId`, when present → SDK inbound dedupe cache (60s TTL). Precedence.
2. Otherwise `codAtendimento` + the exact `chatInput`, valid **only inside the
   in-flight window** — from the publish until the poll that collects the
   agent's answer (safety expiry at 60s if a turn never gets answered).

The window, not a lasting hash of the text, is what keeps a legitimately
repeated answer alive: "1" twice in a two-step menu arrives *after* the first
turn was collected, so the mark is gone and the second "1" publishes normally.
Drops are logged at `debug` (`dropping webhook re-delivery: turn still in
flight`) and still answer `{"pronto":0}`.

The `codAtendimento` is the Omni **chat id**: it is the platform's conversation
identity and the only handle every outbound endpoint accepts.

## Outbound

| Endpoint | When |
|---|---|
| `POST /sendIndicador` | typing, on inbound arrival and after each pushed bubble |
| `POST /callbackFlowMsg` | every bubble EXCEPT the last one (plain text turns) |
| `POST /mensagem` | media, location, contact card, and the interactive last bubble |
| `POST /transferirHumano` | `metadata.isHandoff === true` |

One `sendMessage` is one flow turn. Blank-line-separated paragraphs become
separate bubbles. The bubbles before the last are **pushed** (best-effort, with
typing between them, which is what gives the turn its rhythm); the **last** one
rides back in `resposta`, the single slot the flow's `message` node renders. A
refused push degrades to `resposta` rather than costing the beneficiary the
answer.

### Rich content — `POST /mensagem`

The poll body and `callbackFlowMsg` carry a **string**, so anything that is not
text leaves through `POST /mensagem`, the one endpoint that injects content into
a *running* atendimento. One call per message, `entrante: 0`, `bolFlow: true`.

| `content.type` | Fields sent |
|---|---|
| `image` / `audio` / `video` / `document` | `url_arquivo` when `content.mediaUrl` is a public `http(s)` URL, otherwise `base64_arquivo` + `nome_arquivo` + `mime_type` — from `metadata.base64` / `metadata.audioBuffer` (what `POST /api/v2/messages/send/media` hands over) or, failing that, from `content.localPath` through the SDK media backend |
| `location` | `localizacao: {latitude, longitude, endereco}` — `endereco` is `name - address` |
| `contact` | `cartao_contato: {nome, telefone, email}` |
| any, with `message.replyTo` | `id_mensagem_resposta`, but **only** when the id is numeric (Omni's own UUIDs mean nothing to the platform and are ignored) |

The caption (`content.caption` / `content.text`) goes in `mensagem`, through the
same `markdownToWhatsApp` + emoji-marker encoding as any other text.

Ceiling: **16 MB** outbound (Meta's, since the platform is a BSP on top of it;
base64 inflates by a third). Anything bigger, unreadable, or refused by the
platform is a `warn` and a **degrade to text** — the turn always resolves, or
the flow's `api_rest` node would poll until it times out. A file with no caption
degrades to `[não foi possível enviar o arquivo]` rather than to silence.

`cartao_contato.cod_contato` (a platform-side contact id) has no Omni
equivalent and is never sent. Stickers and reactions are still out of scope: the
platform exposes no endpoint for either.

### Interactive (URA)

`content.buttons` maps onto `ura_opcoes` + `forcar_botoes` through the SDK's
shared `planInteractive`, so **Meta's limits are the ceiling** — the ASC
platform is a BSP on top of Meta, so no limit of theirs can be looser. ≤3
options render as buttons (label ≤20), 4–10 as a list (title ≤24).

The mapping degrades to plain numbered text — never dropping content — when:

- more than 10 options (Meta truncates the overflow silently);
- the body exceeds 1024 characters;
- two titles collide after truncation (the tap comes back as the **title**, so
  a collision would book the wrong appointment).

The numbered text the agent wrote is the canonical path; the URA is only a tap
affordance layered on top of it.

The fields ride in the poll body **and** the last bubble goes out through
`POST /mensagem` with them, which is what makes the buttons/list render without
a URA node in the flow. When that push succeeds, `resposta` comes back **empty**
so the flow's message node does not repeat the bubble — `bolhas` still carries
the full turn. Set `ascFlowInteractiveViaMensagem: false` on the instance to go
back to the numbered text in `resposta` (the previous behavior) if a tenant's
flow renders that bubble itself.

### Handoff

`metadata.isHandoff` drives it. Of the fourteen Genesys userdata fields the ASC
component forwards, exactly two are the agent's: `fila_vq` and
`motivo_transf_vq`. They ride in the `pronto:1` body, from
`metadata.handoffQueue` and `metadata.handoffReason`; `metadata.handoffServico`
overrides the instance's default queue for `transferirHumano`, which is still
called on top of the body's `hand_off:"sim"`.

**`hand_off:"sim"` means the transfer was ACCEPTED — nothing weaker.** It is
what makes the flow route to the Genesys node, so claiming it on a transfer
that never happened leaves the beneficiary reading "vou te transferir" with
nobody on the way. `utils/handoff.ts` validates the inputs before the call and
`sendMessage` wraps the call itself:

| Input | Rule | On violation |
| --- | --- | --- |
| `cod_servico` | positive integer (number, or a fully-numeric string) | **no transfer**, `error` logged, turn answers with `hand_off:"nao"` |
| `cod_prioridade` | `0` or `1` | coerced to `0`, `debug` logged |
| `fila_vq` | `^[A-Za-z0-9_.-]{1,32}$` | field omitted (Genesys uses the flow's default queue), `warn` logged |
| `motivo_transf_vq` | whitespace collapsed, trimmed, ≤255 chars | omitted when empty |
| `POST /transferirHumano` | must succeed | `warn` logged, turn answers with `hand_off:"nao"` |

`Number()` was the original trap and is why this is not inline: `Number("")`
and `Number([])` are `0` — a service that does not exist — and `Number("fila-x")`
is `NaN`, which `JSON.stringify` puts on the wire as `null`.

A failing transfer never fails the turn. The rest of the channel already
degrades this way (`callbackFlowMsg`, media, typing are best-effort); silence
is the worst outcome available to a beneficiary. There is still no domain for
`fila_vq` (the de-para is a pendency on the Hapvida side), so the check above
is shape-only.

## Gotchas

- **401 is overloaded.** `/mensagem` answers 401 with a `cod_error` body for
  *business* failures (`{"cod_error":10,"msg":"Atendimento já finalizado!"}`).
  The client re-authenticates and retries **only** on a 401 with no
  `cod_error` — retrying a business 401 would duplicate the bubble on the
  beneficiary's handset.
- **HTTP 200 is not success.** The platform reports refusals in-band through
  `cod_error` / `sucesso`; `isPlatformOk` checks both.
- **The emulator's `cod_atendimento` is a ghost (`1`)** and the write endpoints
  refuse it. Expected — do not work around it.
- **The token lasts one hour.** Cached per instance, refreshed under five
  minutes remaining.

## Out of scope

Reactions, stickers, edits, deletes, groups, read/delivery receipts, and history
(the platform exposes no transcript API).

## Validated

Ported from a Python adapter that ran the full conversational loop against the
ASC emulator (auth + token cache, the 401 gotcha, bubble sequencing, URA
button/list selection and every degradation, `transferirHumano`), including the
same synchronous "leading bubbles pushed, last one in `resposta`" strategy. Text, inbound media and the turn machinery were exercised
on the live number 01/09; the `/mensagem` paths (media, location, contact,
interactive) are covered by tests against a doubled `fetch` and still need one
live pass on a real `cod_atendimento`.
