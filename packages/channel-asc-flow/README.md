# @omni/channel-asc-flow

ASC platform **Flow** channel. The conversation lives inside a flow on the ASC
platform: the flow calls Omni, and Omni answers through the platform's REST API
(`/rest/v2`).

```
WhatsApp → ASC (Flow) → api_rest node → Omni → agent
         → callbackFlowMsg / mensagem (bubbles)
         → callbackFlow (variables; the flow resumes)
         → transferirHumano (when the turn hands off)
```

## Not `@omni/channel-asc`

| | `channel-asc` | `channel-asc-flow` (this) |
|---|---|---|
| Talks to | `apigw.ascbrazil.com.br` (API Gateway) | the platform (`/rest/v2`) |
| Model | BSP direct — a WhatsApp Cloud API mirror | integration via the platform's Flow |
| Inbound | Meta-format webhooks | the flow's `api_rest` node calls us |
| Outbound | `POST /api/v1/messages` (Graph shape) | `callbackFlowMsg` / `mensagem` / `callbackFlow` |
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
`messageId` (alias `idMensagem`) enables inbound dedupe; without it every
delivery is treated as new — deliberately, since deriving an id from the text
would silently swallow a legitimately repeated answer ("1" twice in a two-step
menu).

The `codAtendimento` is the Omni **chat id**: it is the platform's conversation
identity and the only handle every outbound endpoint accepts.

## Outbound

| Endpoint | When |
|---|---|
| `POST /sendIndicador` | typing, on inbound arrival and between bubbles |
| `POST /callbackFlowMsg` | a plain text bubble inside the flow |
| `POST /mensagem` | the last bubble when it carries URA options |
| `POST /callbackFlow` | writes the flow variables and resumes the flow |
| `POST /transferirHumano` | `metadata.isHandoff === true` |

One `sendMessage` is one flow turn. Blank-line-separated paragraphs become
separate bubbles.

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

### Handoff

`metadata.isHandoff` drives it. Of the fourteen Genesys userdata fields the ASC
component forwards, exactly two are the agent's: `fila_vq` and
`motivo_transf_vq`. They travel as flow variables on `callbackFlow`, from
`metadata.handoffQueue` and `metadata.handoffReason`; `metadata.handoffServico`
overrides the instance's default queue for `transferirHumano`.

## Gotchas

- **401 is overloaded.** `/mensagem` answers 401 with a `cod_error` body for
  *business* failures (`{"cod_error":10,"msg":"Atendimento já finalizado!"}`).
  The client re-authenticates and retries **only** on a 401 with no
  `cod_error` — retrying a business 401 would duplicate the bubble on the
  beneficiary's handset.
- **HTTP 200 is not success.** The platform reports refusals in-band through
  `cod_error` / `sucesso`; `isPlatformOk` checks both.
- **`flow_variaveis` has two shapes.** The swagger schema says object, the
  endpoint's own example says list. We send the object and retry as
  `[{nome, valor}]` if it is refused. Safe to retry: it writes variables, it
  does not deliver a bubble.
- **The token lasts one hour.** Cached per instance, refreshed under five
  minutes remaining.

## Out of scope (v1)

Media in either direction (the `api_rest` node hands us a string), reactions,
edits, deletes, groups, read/delivery receipts, and history (the platform
exposes no transcript API).

## Validated

Ported from a Python adapter that ran the full conversational loop against the
ASC emulator (auth + token cache, the 401 gotcha, bubble sequencing, URA
button/list selection and every degradation, `callbackFlow` shape tolerance,
`transferirHumano`). **Not yet exercised against a real atendimento** — that
needs a live number, which is blocked with the client.
