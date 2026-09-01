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
| `POST /callbackFlowMsg` | every bubble EXCEPT the last one |
| `POST /transferirHumano` | `metadata.isHandoff === true` |

One `sendMessage` is one flow turn. Blank-line-separated paragraphs become
separate bubbles. The bubbles before the last are **pushed** (best-effort, with
typing between them, which is what gives the turn its rhythm); the **last** one
rides back in `resposta`, the single slot the flow's `message` node renders. A
refused push degrades to `resposta` rather than costing the beneficiary the
answer.

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
affordance layered on top of it. In the poll model the `ura_opcoes` /
`forcar_botoes` fields ride in the response body, so they render as a real
component only once the flow has a URA node consuming them — until then the
options are the numbered text inside `resposta`. Same ceiling the Python
adapter ships with, and no code change here when that node exists.

### Handoff

`metadata.isHandoff` drives it. Of the fourteen Genesys userdata fields the ASC
component forwards, exactly two are the agent's: `fila_vq` and
`motivo_transf_vq`. They ride in the `pronto:1` body, from
`metadata.handoffQueue` and `metadata.handoffReason`; `metadata.handoffServico`
overrides the instance's default queue for `transferirHumano`, which is still
called on top of the body's `hand_off:"sim"`.

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

## Out of scope (v1)

Media **outbound** (the poll body and `callbackFlowMsg` both carry a string —
inbound media *is* supported, see above), reactions,
edits, deletes, groups, read/delivery receipts, and history (the platform
exposes no transcript API).

## Validated

Ported from a Python adapter that ran the full conversational loop against the
ASC emulator (auth + token cache, the 401 gotcha, bubble sequencing, URA
button/list selection and every degradation, `transferirHumano`), including the
same synchronous "leading bubbles pushed, last one in `resposta`" strategy. **Not yet exercised against a real atendimento** — that
needs a live number, which is blocked with the client.
