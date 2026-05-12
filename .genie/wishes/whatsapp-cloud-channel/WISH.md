# Wish: WhatsApp Cloud API Channel (Embedded Signup + Templates HSM)

**Status:** READY
**Slug:** whatsapp-cloud-channel
**Priority:** P1
**Date:** 2026-05-12
**Author:** Analista (port do TalkFlow para Omni)

---

## Sumario

Portar a integracao com a **API oficial da Meta WhatsApp (Cloud API)** do projeto **TalkFlow** (Python/FastAPI) para o **Omni** (Bun/TypeScript) como um novo Channel Plugin chamado **`@omni/channel-whatsapp-cloud`**. O ChannelType `whatsapp-cloud` ja esta reservado no enum (`packages/core/src/types/channel.ts`, `packages/db/src/schema.ts`, UI) mas o package nao existe — esta marcado como "TODO: Implement later" em `apps/ui/src/components/instances/CreateInstanceModal.tsx`. A logica de OAuth Embedded Signup, envio via Graph API v25.0, templates HSM (CRUD + envio), e webhook assinado pela Meta ja funcionam em producao no TalkFlow e serao adaptadas para o modelo event-driven do Omni (NATS JetStream + BaseChannelPlugin + Drizzle).

---

## Contexto e Motivacao

### Por que portar?

- O Omni hoje suporta WhatsApp **somente via Baileys** (nao-oficial, sujeito a banimento). Para clientes B2B / WABA-verified, e mandatorio usar a API oficial.
- A roadmap do Omni declara `whatsapp-cloud` como "Planned" (README.md, badge "channels-3") e ja consumiu o ChannelType em toda a base (registry de capabilities, follow-up sweeper, agent-dispatcher reaction-ack, etc.).
- O Gupshup channel cobre WhatsApp via BSP de terceiros, mas nao substitui a integracao direta com Meta (custo, controle de templates, Embedded Signup, billing/quality nativos).
- O TalkFlow ja resolveu os pontos dificeis em producao: Embedded Signup (troca de code -> token -> subscribe app), descoberta de WABA + Phone Numbers, assinatura HMAC-SHA256 do webhook, debounce de mensagens, multi-conexao por tenant, templates HSM com componentes (header media, body com variaveis, buttons), envio de templates Authentication com `copy_code`.

### Codigo de origem (TalkFlow)

Repo: `C:\Users\Bruno\Documents\Projetos\talkflow\talkflow_backend\`

Stack atual: Python 3.12 + FastAPI + SQLAlchemy 2.0 + Alembic + httpx + tenant_id varchar(36).
Stack destino (Omni): Bun + TypeScript + Hono + Drizzle + NATS + Zod + `BaseChannelPlugin`.

Multi-tenant do TalkFlow nao tem equivalente direto no Omni — no Omni a granularidade e por **instance** (uma WABA + phone_number = uma `instances` row). Cada instance vira o "tenant" funcional desta integracao.

---

## Escopo

### IN

- Novo package `packages/channel-whatsapp-cloud/` seguindo o padrao de `packages/channel-gupshup/` (webhook-based, REST outbound, sem socket persistente).
- Plugin `WhatsAppCloudPlugin extends BaseChannelPlugin` com:
  - `connect()` / `disconnect()` / `getStatus()` / `getHealth()`
  - `sendMessage()` para `text`, `image`, `audio`, `video`, `document`, `sticker`, `location`, `contact`, `reaction`, `template`
  - `handleWebhook()` recebendo callbacks de `messages`, `statuses`, `message_template_status_update`
  - `markAsRead()` (Meta suporta via POST `/{phone_number_id}/messages` com `status: read`)
  - Capabilities (`canSendButtons`, `canSendLocation`, `canSendSticker`, `messagingWindow24h: true`, etc.) — Cloud API tem janela de 24h ja referenciada em `packages/core/src/automations/follow-up/capabilities.ts`.
- **Embedded Signup OAuth** server-side: troca de `code` por `access_token`, descoberta de WABAs + Phone Numbers, registro automatico do numero (`/register`), subscribe do app em todos os WABAs descobertos.
- **Webhook endpoint publico** em `/api/v2/channels/whatsapp-cloud/webhook` (auth-exempt, igual ao Gupshup) com:
  - GET para verificacao (`hub.mode`, `hub.verify_token`, `hub.challenge`)
  - POST com validacao de assinatura `X-Hub-Signature-256` (HMAC-SHA256 com `app_secret`)
  - Resolucao de instance via `phone_number_id` do payload (suporta multi-instance)
  - Processamento de `messages[]`, `statuses[]` (delivered/read/failed/sent), `errors[]`
- **Templates HSM** com endpoints REST + tabela `meta_templates`:
  - List/Get/Create/Delete templates (sincroniza com Graph API)
  - Categorias: `MARKETING`, `UTILITY`, `AUTHENTICATION`
  - Componentes: HEADER (text/image/video/document/location), BODY com `{{1}}` variaveis, FOOTER, BUTTONS (`QUICK_REPLY`, `URL`, `PHONE_NUMBER`, `COPY_CODE` p/ authentication)
  - Upload de header media (`POST /{app_id}/uploads`)
  - Envio de template via `messages` com `type: template`
- **Um par `(waba, phone_number)` por instance** (padrao Omni, alinhado com `discord_bot_token` / `telegram_bot_token`). Persistencia via colunas inline em `instances` — ver "Modelo de Dados". Se aparecer demanda multi-numero, criar tabela auxiliar em wish futura.
- **Profile management**: GET/UPDATE business profile (about, address, description, vertical, profile photo).
- **Quality + analytics**: GET `/{phone_number_id}` para quality_rating, messaging_limit, conversations counter.
- **Frontend (apps/ui)**:
  - Habilitar `whatsapp-cloud` em `CreateInstanceModal` (remover `disabled: true`)
  - Wizard com **2 modos** (decisao final): (1) Embedded Signup via Facebook JS SDK (`FB.login` com `config_id`) e (2) paste manual (`access_token` + `phone_number_id` + `wabaId`)
  - Tela mostrando numero conectado + quality_rating
  - Tela de Templates (CRUD + preview)
  - Envio de template para iniciar conversas fora da janela 24h
- Reuso de capacidades existentes: `messagingWindow24h` ja no follow-up sweeper, reaction-ack ja suporta `whatsapp-cloud`, agent-dispatcher ja roteia por channel.
- **CLI**: integrar comandos existentes (`omni instances connect <id> --access-token <token> --phone-number-id <id>` para modo manual e `omni send`). Sem comandos novos especificos de templates nesta wish.

### OUT (nao faz parte desta wish)

- Migracao do AgentEngine LangGraph do TalkFlow (Omni usa seu proprio dispatcher de agentes — `packages/api/src/plugins/agent-dispatcher.ts`).
- Sistema de campanhas / envio em massa (`campaign_routes.py`, `campaign_worker.py`) — fica para wish separada se o produto Omni precisar de envio em massa de templates.
- CLI de templates (`omni templates list|create|delete`) — fica para wish separada futura. Esta wish entrega templates via REST + UI somente.
- Stickers gallery (`sticker_routes.py`) — pode reusar `packages/media-processing` em wish separada.
- `AttendantQueue` (fila humana) — nao e conceito do Omni v2.
- `Contact` / `Conversation` tables especificas do TalkFlow — Omni usa o identity-graph (`persons` + `platform_identities`) ja existente.
- Deprecation do channel-whatsapp Baileys — co-existe.
- WhatsApp Business Java SDK ou bibliotecas wrapper — chamadas diretas para Graph API via `fetch` (Bun nativo).
- Encryption at-rest de access_token — tratada como debito tecnico, ver rodape "Debito Tecnico".

---

## Inventario do que migrar

Mapeamento arquivo TalkFlow -> arquivo destino no Omni. Quando o destino e `(novo)`, e codigo a escrever do zero seguindo padroes Omni (nao traducao linha-a-linha).

### Backend Python -> TypeScript

| TalkFlow (origem) | Omni (destino) | Observacao |
|---|---|---|
| `src/integrations/meta_oauth_service.py` (`MetaOAuthService`) | `packages/channel-whatsapp-cloud/src/oauth.ts` (novo) | Logica de `exchange_code_for_token`, `get_waba_details`, `register_phone_number`, `subscribe_app` |
| `src/integrations/meta_whatsapp_client.py` (`MetaWhatsAppClient`) | `packages/channel-whatsapp-cloud/src/client.ts` (novo) | Cliente HTTP para `graph.facebook.com/v25.0/{phone_number_id}/...`. Usa `fetch` nativo do Bun. |
| `src/integrations/meta_template_service.py` (`MetaTemplateService`) | `packages/channel-whatsapp-cloud/src/templates.ts` (novo) | CRUD de templates via Graph API + sincronizacao local |
| `src/integrations/whatsapp_client_factory.py` (roteador Bot/Meta) | N/A | No Omni cada plugin e isolado, dispatch por `channelType` ja existe |
| `src/integrations/whatsapp_config_manager.py` (multi-conexao por tenant) | `packages/db/src/schema.ts` + repository | Conexao vira **colunas inline** na tabela `instances` (1 par WABA/phone por instance — decisao final) |
| `src/api/meta_whatsapp_routes.py` (Embedded Signup + numeros + billing) | `packages/api/src/routes/v2/whatsapp-cloud.ts` (novo) | Endpoints REST + OpenAPI (Hono + zValidator) |
| `src/api/meta_template_routes.py` (templates HSM) | `packages/api/src/routes/v2/templates.ts` (novo) | CRUD de templates + envio. Tabela `meta_templates` -> `whatsapp_templates`. |
| `src/api/meta_webhook_routes.py` (webhook publico) | `packages/api/src/app.ts` (registrar rota publica) + `packages/channel-whatsapp-cloud/src/handlers/webhook.ts` (novo) | Mesma estrategia do gupshup webhook em `app.ts:217` |
| `src/database/models.py::MetaTemplate` | `packages/db/src/schema.ts::whatsappTemplates` | Drizzle table |
| `src/database/models.py::Conversation.meta_phone_number_id` | `messages` / `chats` tables ja existentes no Omni | Usar `instanceId` + `chatId` padrao do Omni |
| Migrations Alembic relacionadas a Meta | `packages/db/drizzle/NNNN_<name>.sql` | Gerar via `bunx drizzle-kit generate` |
| `guide/WHATSAPP_INTEGRATION.md` | `packages/channel-whatsapp-cloud/CLAUDE.md` + `docs/channels/whatsapp-cloud.md` | Documentacao funcional |

### Frontend (React TS no TalkFlow -> React TS no Omni)

Sao stacks semelhantes (React 19 vs React, ambos TS, ambos Vite). A diferenca principal e que o TalkFlow usa MUI + TanStack Query + Zustand + Axios, enquanto o Omni usa Tailwind + React Query + SDK auto-gerado. Adaptar componentes.

| TalkFlow (origem) | Omni (destino) | Observacao |
|---|---|---|
| `talkflow_frontend/src/hooks/useFacebookSDK.ts` | `apps/ui/src/hooks/useFacebookSDK.ts` (novo) | Carrega FB SDK e expoe `loginWithEmbeddedSignup(configId)` |
| `talkflow_frontend/src/api/endpoints/metaWhatsapp.ts` | `apps/ui/src/api/whatsappCloud.ts` (novo, ou via SDK auto-gerado apos `make sdk-generate`) | Wrappers tipados |
| `talkflow_frontend/src/api/endpoints/metaTemplates.ts` | `apps/ui/src/api/templates.ts` (novo) | Idem |
| `talkflow_frontend/src/features/whatsapp/` (Embedded Signup, lista de conexoes) | `apps/ui/src/components/instances/WhatsAppCloudConnect.tsx` (novo) | Integrar dentro do fluxo existente do `CreateInstanceModal` (passos: `channel -> details -> connect`) |
| (telas de templates) | `apps/ui/src/pages/Templates.tsx` (novo) ou aba dentro de `InstanceDetail` | Lista, builder, preview, sync com Meta |

---

## Mudancas necessarias de padronizacao

| Aspecto | TalkFlow | Omni — adaptacao |
|---|---|---|
| Linguagem | Python 3.12 | TypeScript estrito (`noImplicitAny`, sem `any`) |
| Validacao | Pydantic | Zod (schemas em `packages/core/src/schemas/` quando compartilhado, locais quando especifico) |
| HTTP server | FastAPI router | Hono + `zValidator` + OpenAPI auto-gerado |
| HTTP client | `httpx.AsyncClient` | `fetch` nativo do Bun |
| ORM | SQLAlchemy 2.0 | Drizzle |
| Migrations | Alembic | `bunx drizzle-kit generate` (auto-migrate no boot) |
| Auth | JWT custom + tenant_id | `x-api-key` + scopes (`namespace:action`) — ja existente |
| Multi-tenant | `tenant_id` em toda tabela | Multi-instance via FK `instanceId` (cada instance e isolada) |
| Logs | `logging.getLogger(__name__)` com prefixo `[META_*]` | `import { logger } from '@omni/core'` (winston/pino) — verificar padrao real no `packages/core/src/utils/` |
| Idioma de logs | Portugues do Brasil | Ingles (Omni e codebase internacional — alinhar com `docs/`) |
| Idioma do codigo | Ingles | Ingles |
| Eventos | Socket.IO direto | NATS JetStream via `eventBus.publish()` |
| Excecoes | `HTTPException` (FastAPI) | `OmniError` (`packages/core/src/errors/`) com `code`, `context`, `recoverable` |
| Workers | Asyncio background tasks | NATS subjects + worker consumers (ver padrao do `packages/api/src/plugins/agent-dispatcher.ts`) |
| Segredos | `.env` + `tenant_config` JSON no banco | `.env` para app-level; instance-level criptografado (verificar como Discord/Telegram tokens sao armazenados — atualmente em texto na coluna `discord_bot_token`) |

### Eventos a emitir

Seguindo o padrao do Omni (snake_case com namespace por dominio), o plugin deve publicar:

- `message.received` — toda mensagem inbound (text, media, location, contact, reaction, button_reply, list_reply)
- `message.sent` — confirmacao apos POST /messages bem-sucedido (com `wamid`)
- `message.delivered` — webhook `statuses[].status == "delivered"`
- `message.read` — webhook `statuses[].status == "read"`
- `message.failed` — webhook `statuses[].status == "failed"` (incluir `errors[]` no payload)
- `instance.connected` — apos OAuth + subscribe app bem-sucedidos
- `instance.disconnected` — apos `delete_meta_config` ou revogacao do access_token
- `template.status_changed` — webhook `message_template_status_update`. **Evento unico** (nao separar em `template.approved` / `template.rejected`). Payload inclui `{ templateId, templateName, language, previousStatus, newStatus, rejectionReason? }`. Consumidores filtram por `payload.newStatus`.

Verificar em `packages/core/src/events/types.ts` quais eventos ja existem para reuso. `template.status_changed` e evento novo — adicionar ao `CORE_EVENT_TYPES`.

---

## Modelo de Dados

### Nova tabela: `whatsapp_templates`

```ts
// packages/db/src/schema.ts
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id').notNull().references(() => instances.id, { onDelete: 'cascade' }),
    metaId: varchar('meta_id', { length: 64 }),         // ID retornado pela Graph API
    wabaId: varchar('waba_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    language: varchar('language', { length: 16 }).notNull().default('pt_BR'),
    category: varchar('category', { length: 32 }).notNull(),  // MARKETING | UTILITY | AUTHENTICATION
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),  // APPROVED | PENDING | REJECTED | PAUSED | DELETED
    components: jsonb('components').$type<WhatsAppTemplateComponent[]>(),
    variableMapping: jsonb('variable_mapping').$type<Record<string, Record<string, string>>>(),
    rejectionReason: text('rejection_reason'),
    qualityScore: varchar('quality_score', { length: 16 }),  // GREEN | YELLOW | RED | UNKNOWN
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    instanceIdx: index('idx_wa_tpl_instance').on(t.instanceId),
    instanceNameLangUnique: uniqueIndex('idx_wa_tpl_instance_name_lang').on(t.instanceId, t.name, t.language),
  }),
);
```

### Novas colunas em `instances` (para WhatsApp Cloud)

```ts
// Adicionar ao bloco existente "WhatsApp Configuration":
metaPhoneNumberId: varchar('meta_phone_number_id', { length: 64 }),
metaWabaId: varchar('meta_waba_id', { length: 64 }),
metaAccessToken: text('meta_access_token'),                  // plain text (paridade com discord_bot_token); encryption at-rest e debito tecnico — ver rodape
metaAppId: varchar('meta_app_id', { length: 64 }),
metaBusinessId: varchar('meta_business_id', { length: 64 }),
metaApiVersion: varchar('meta_api_version', { length: 16 }).notNull().default('v25.0'),  // snapshot da versao usada no provisionamento; runtime usa env META_GRAPH_API_VERSION
metaConnectionMethod: varchar('meta_connection_method', { length: 32 }).default('manual'),  // manual | embedded_signup
metaDisplayPhoneNumber: varchar('meta_display_phone_number', { length: 32 }),
metaConnectedAt: timestamp('meta_connected_at'),
```

**Decisao**: um par `(waba, phone_number)` por instance — colunas inline em `instances` (acima). Alinhado com como `discord_bot_token`, `telegram_bot_token` ja sao modelados hoje. Multi-numero por instance fica para wish futura, se aparecer demanda.

**`metaAccessToken`** e armazenado **em texto plano** por paridade com `discord_bot_token` (texto plano hoje). Encryption at-rest e tratada como debito tecnico — ver rodape.

### Migration

- Gerar via `cd packages/db && bunx drizzle-kit generate`.
- O API auto-migra no boot (`packages/api/src/index.ts::migrateDb()`), entao basta commitar a SQL + snapshot + `_journal.json` juntos.
- NUNCA usar `drizzle-kit push` em CI (regra do projeto, `CLAUDE.md`).

---

## Endpoints (Hono)

Todos protegidos por `authMiddleware` exceto o webhook publico. Base: `/api/v2`.

### Embedded Signup + Conexao

| Metodo | Path | Auth | Body / Query | Resposta |
|---|---|---|---|---|
| `POST` | `/instances/:id/whatsapp-cloud/oauth/exchange` | scope `instances:write` | `{ code: string }` | `{ accessToken, wabaIds[], phoneNumbers[] }` (NUNCA retornar `accessToken` em producao — usar apos confirmar) |
| `POST` | `/instances/:id/whatsapp-cloud/connect` | `instances:write` | `{ accessToken, phoneNumberId, wabaId, appId? }` | `{ status: 'connected', displayPhoneNumber, qualityRating }` |
| `POST` | `/instances/:id/whatsapp-cloud/register` | `instances:write` | `{ pin?: string }` | `{ ok: true }` — registra o numero via `POST /{phone_number_id}/register` |
| `POST` | `/instances/:id/whatsapp-cloud/subscribe-app` | `instances:write` | `{}` | `{ subscribed: true }` — `POST /{waba_id}/subscribed_apps` |
| `GET` | `/instances/:id/whatsapp-cloud/connection` | `instances:read` | — | retorna `{ phoneNumberId, wabaId, displayPhoneNumber, connectionMethod, connectedAt, qualityRating }` da instance (singular — 1 par por instance) |
| `DELETE` | `/instances/:id/whatsapp-cloud/connection` | `instances:write` | — | revoga (zera `metaAccessToken`/`metaPhoneNumberId`/`metaWabaId`) e marca instance como `disconnected` |
| `GET` | `/instances/:id/whatsapp-cloud/quality` | `instances:read` | — | `{ quality_rating, messaging_limit, throughput }` |
| `GET` | `/instances/:id/whatsapp-cloud/analytics` | `instances:read` | `?start=&end=&granularity=` | metricas de conversa |
| `GET` | `/instances/:id/whatsapp-cloud/profile` | `instances:read` | — | business profile |
| `PUT` | `/instances/:id/whatsapp-cloud/profile` | `instances:write` | `{ about, address, description, vertical, websites[], email }` | profile atualizado |
| `POST` | `/instances/:id/whatsapp-cloud/profile/photo` | `instances:write` | multipart `file` | `{ ok: true }` |

### Templates HSM

| Metodo | Path | Auth | Body / Query | Resposta |
|---|---|---|---|---|
| `GET` | `/instances/:id/whatsapp-templates` | `instances:read` | `?status=&category=&language=` | lista (com sync opcional via `?sync=true`) |
| `GET` | `/instances/:id/whatsapp-templates/:templateId` | `instances:read` | — | template detalhado |
| `POST` | `/instances/:id/whatsapp-templates` | `instances:write` | `CreateTemplateRequest` (name, language, category, components[]) | template criado (status: PENDING) |
| `DELETE` | `/instances/:id/whatsapp-templates/:templateId` | `instances:write` | — | remove na Meta e localmente |
| `POST` | `/instances/:id/whatsapp-templates/upload-header-media` | `instances:write` | multipart `file` | `{ handle: string }` para usar em componente HEADER |
| `POST` | `/instances/:id/whatsapp-templates/:templateId/send-test` | `instances:write` | `{ to: string, variables: Record<string,string> }` | `{ wamid }` |
| `POST` | `/instances/:id/whatsapp-templates/:templateName/send` | `instances:write` | `{ to, language, variables, headerMedia? }` | `{ wamid }` — usa nome para retro-compatibilidade |

### Webhook publico

A Meta App tem **um unico** verify token + app_secret configurados no Meta for Developers UI. Diferente do Gupshup (que recebe `:instanceId` no path) e do Telegram (per-instance secret no header), aqui o URL e **global, sem `:instanceId`**. A resolucao da instance vem do payload (`metadata.phone_number_id`).

| Metodo | Path | Auth | Descricao |
|---|---|---|---|
| `GET` | `/api/v2/channels/whatsapp-cloud/webhook` | publico | verificacao Meta (`hub.mode=subscribe` + `hub.verify_token`). Le `META_VERIFY_TOKEN` da env (global). |
| `POST` | `/api/v2/channels/whatsapp-cloud/webhook` | publico (assinado) | valida `X-Hub-Signature-256` (HMAC-SHA256 com `META_APP_SECRET`), resolve instance pelo `metadata.phone_number_id`, despacha para `plugin.handleWebhook(req)`. |

Mounting analogo ao Gupshup em `packages/api/src/app.ts:217` (mesma estrategia de mount publico antes de `protectedApp`), porem **sem `:instanceId`** no path — a resolucao da instance acontece dentro do handler via lookup `instances.metaPhoneNumberId = payload.metadata.phone_number_id`.

### Schemas Zod

Definir em `packages/channel-whatsapp-cloud/src/schemas/` (compartilhar com routes via re-export). Schemas chave:

- `EmbeddedSignupExchangeRequest`, `EmbeddedSignupExchangeResponse`
- `MetaWebhookPayload` (com discriminated union para `messages | statuses | message_template_status_update`)
- `MetaMessage` (text, image, audio, video, document, sticker, location, contacts, interactive)
- `WhatsAppTemplateComponent` (HEADER, BODY, FOOTER, BUTTONS — com sub-variantes)
- `SendTemplateRequest`

---

## Frontend (apps/ui)

### Mudancas em telas existentes

1. **`apps/ui/src/components/instances/CreateInstanceModal.tsx`** — remover `disabled: true` da entrada `whatsapp-cloud` e adicionar branch no fluxo de `step === 'connect'` para mostrar `WhatsAppCloudConnect` (em vez do QR do Baileys).
2. **`apps/ui/src/components/instances/AgentConfigForm.tsx`** — verificar se precisa de ajuste para a janela de 24h ja considerada no follow-up.

### Componentes novos

- `apps/ui/src/components/instances/WhatsAppCloudConnect.tsx` — wizard com **2 modos** (tabs):
  1. **Embedded Signup** (caminho feliz: Facebook JS SDK + `FB.login({ config_id })` -> troca de code -> connect)
  2. **Manual** (paste de `access_token` + `phone_number_id` + `wabaId`, util para dev/test e tenants ja com WABA configurada fora do Embedded Signup)
- `apps/ui/src/pages/Templates.tsx` (ou aba dentro da pagina de instance) — lista + filtros + builder.
- `apps/ui/src/components/templates/TemplateBuilder.tsx` — editor visual de componentes (HEADER text/media, BODY com placeholders, FOOTER, BUTTONS).
- `apps/ui/src/components/templates/TemplatePreview.tsx` — renderiza preview no estilo WhatsApp.
- `apps/ui/src/hooks/useFacebookSDK.ts` — port do TalkFlow.

### SDK auto-gerado

Apos adicionar as rotas em `packages/api/src/routes/v2/`, rodar `make sdk-generate` para regenerar `packages/sdk/src/types.generated.ts`. O frontend consome via `omni.whatsappCloud.*` / `omni.templates.*`.

---

## Variaveis de Ambiente

Adicionar ao `.env.example`:

```bash
# -----------------------------------------------------------------------------
# WhatsApp Cloud API (Meta) — global app-level config
# Each instance carries its own phone_number_id + access_token (per-instance).
# -----------------------------------------------------------------------------
# META_APP_ID=                       # Facebook App ID (Meta for Developers)
# META_APP_SECRET=                   # Facebook App Secret — used to verify X-Hub-Signature-256 (HMAC-SHA256). NEVER expose to client.
# META_VERIFY_TOKEN=                 # Shared secret for webhook subscription verification (one-shot, configured once in Meta App UI).
# META_GRAPH_API_VERSION=v25.0       # Graph API version (default v25.0). No per-instance override.
# META_EMBEDDED_SIGNUP_CONFIG_ID=    # Configuration ID for FB.login() Embedded Signup flow
# META_WEBHOOK_BASE_URL=             # Public URL where Meta webhooks should land (used in setup docs only)
```

### Naming rationale

O Omni hoje **nao usa namespace de provider** em ENVs internas (`SENTRY_*`, `OMNI_*`, `WEBHOOK_BASE_URL`, `NATS_URL`). Gupshup e Telegram nao tem ENVs especificas — esses providers carregam tokens **per-instance** no banco (`webhookVerifyToken` na coluna `instances`).

WhatsApp Cloud e diferente: a Meta App tem **um unico** verify token + app_secret configurados uma vez no Meta for Developers UI, compartilhados entre TODAS as instances que apontam para este `META_APP_ID`. Por isso vai como ENV global. O prefixo `META_*` segue a propria nomenclatura do produto Meta (documentacao oficial: `WHATSAPP_BUSINESS_API_VERIFY_TOKEN` -> abreviado para `META_VERIFY_TOKEN`, e `app_secret` -> `META_APP_SECRET`). Nao colide com nenhum ENV existente.

### Per-instance vs. global

- **Global (env)**: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_EMBEDDED_SIGNUP_CONFIG_ID`.
- **Per-instance (banco)**: `metaPhoneNumberId`, `metaWabaId`, `metaAccessToken`, `metaDisplayPhoneNumber`, `metaConnectedAt`, `metaConnectionMethod`.
- **Override per-instance opcional**: `metaAppId`, `metaBusinessId` (caso o cliente tenha App proprio). Se setados, usar prioridade no banco; caso contrario, fallback para env. (Apenas leitura — App Secret nao vai per-instance.)
- `metaApiVersion` no banco existe so como "ultima versao usada" no provisionamento; runtime usa `META_GRAPH_API_VERSION` da env.

---

## Dependencias Externas

- Nenhum SDK npm oficial da Meta — todas chamadas a Graph API sao `fetch` direto.
- **Facebook JS SDK** no frontend (CDN, carregado dinamicamente em `useFacebookSDK.ts`). Nao adiciona dependencia npm.
- Reuso interno:
  - `@omni/channel-sdk` (`BaseChannelPlugin`, `createInboundDedupeCache`, `sanitizeMessage`)
  - `@omni/core` (logger, errors, eventBus, schemas compartilhados)
  - `zod` para validacao
- Para HMAC-SHA256 (assinatura webhook): `crypto.subtle` da Web Crypto API (nativo do Bun) — nao precisa de lib externa.

---

## Riscos / Pontos de Atencao

1. **Armazenamento de access_token (decidido)**: persistir **plain text** em `instances.metaAccessToken`, paridade com `discord_bot_token` / `telegram_bot_token` / `gupshupAuthToken`. Token Meta e long-lived (60 dias para user tokens, infinito para System User). Encryption at-rest tratada como debito tecnico (ver rodape) — wish separada futura cobrira **todos** os tokens de channels de uma vez.
2. **Assinatura HMAC do webhook**: implementar **e** testar com payloads reais. Falha de assinatura -> 401 + log de seguranca (sem stacktrace para o cliente). Usar `timingSafeEqual` para evitar timing attack.
3. **Janela de 24h**: ja existe suporte no follow-up sweeper (`packages/core/src/automations/follow-up/capabilities.ts:54`). Fora da janela, **so** templates podem ser enviados. O plugin deve detectar e retornar erro tipado `OMNI_OUTSIDE_24H_WINDOW` quando o app tentar enviar `text/media` sem template.
4. **Rate limits Meta**: 80 req/s por phone_number_id, 200 mensagens/dia/conversa para Tier 1, etc. Implementar:
   - Rate limit local no `client.ts` (token bucket).
   - Retry com backoff exponencial em 429 e 5xx (reuso do padrao em `packages/channel-sdk/src/utils/` se houver).
5. **Phone Number Registration**: numeros novos via Embedded Signup precisam de PIN de 6 digitos (`/register`). Documentar fluxo (Meta gera PIN ou usuario define).
6. **Multi-instance + mesmo webhook URL**: o webhook e global (`/api/v2/channels/whatsapp-cloud/webhook`). Resolucao da instance correta DEVE vir de `entry[].changes[].value.metadata.phone_number_id` -> query no banco. Tratar caso de phone_number_id desconhecido (silenciar com 200 + log warning, NUNCA 4xx — Meta des-assina o app apos retries).
7. **Verificacao do webhook na configuracao Meta**: o `META_VERIFY_TOKEN` e definido na app Meta uma unica vez (nao por instance). Documentar bem.
8. **Templates rejected/paused**: webhook `message_template_status_update` chega com motivo. Persistir `rejectionReason` para a UI.
9. **OAuth code reuse**: codes de OAuth sao single-use. Detectar duplicacao e retornar erro claro.
10. **Embedded Signup config_id**: requer aprovacao da Meta (App Review). Documentar em `docs/channels/whatsapp-cloud.md` que producao exige aprovacao + Business Verification.
11. **LGPD / PII + Sentry scrubbing**: textos de mensagem podem conter PII (telefones E.164, profile names, conteudo livre) e o `access_token` Meta pode aparecer em error contexts de chamadas Graph API. O Omni ja tem `beforeSend` global em `packages/api/src/instrument.ts` — esta wish DEVE auditar e estender o scrubbing para mascarar: (a) `text` de mensagens inbound/outbound, (b) telefones em formato E.164, (c) `profile_name`, (d) `access_token` em qualquer event/context do plugin. Validar com payload de teste capturado (ver criterio de aceitacao tecnico).
12. **Idempotencia de webhook**: Meta pode reentregar o mesmo payload. Usar `createInboundDedupeCache` (`@omni/channel-sdk`) com `wamid` como key — mesmo padrao do gupshup.
13. **Reaction-ack**: ja suportado em `packages/channel-sdk/src/reaction-ack.ts:169` (`whatsapp-cloud` esta na lista). Validar que reactions inbound viram `reaction.received` e que `react()` outbound funciona.
14. **agent-dispatcher**: ja roteia `whatsapp-cloud` para o branch correto (`packages/api/src/plugins/agent-dispatcher.ts:346` + `:429`). Confirmar que o length cap (65536) e adequado.

---

## Criterios de Aceitacao

### Funcional

- [ ] Criar instance com `channel: 'whatsapp-cloud'` via `POST /instances` (UI ou CLI) — instance criada com state `disconnected`.
- [ ] Fluxo Embedded Signup completo: usuario faz `FB.login(config_id)` -> frontend recebe `code` -> backend troca por `accessToken` -> descobre `wabaId` + `phoneNumberId` -> persiste em `instances` -> registra numero (`/register`) -> subscribe app (`/subscribed_apps`) -> instance vira `connected` -> evento `instance.connected` publicado no NATS.
- [ ] Envio de mensagem `text` via `omni send --to <e164> --text "..." --instance <id>` chega no celular destino.
- [ ] Envio de `image | audio | video | document | sticker` com URL ou media_id funciona.
- [ ] Envio de `location` com lat/lng funciona.
- [ ] Envio de `template` aprovado funciona dentro e fora da janela 24h.
- [ ] Inbound: ao receber texto no numero conectado, evento `message.received` e publicado e o agent dispatcher consegue responder.
- [ ] Inbound: mensagens com media (audio/image/video/document) sao processadas, media baixada via `/{media_id}` e disponivel para o agent.
- [ ] Inbound: reactions geram `reaction.received` com referencia ao `messageId` original.
- [ ] Webhook `statuses` produz `message.delivered`, `message.read`, `message.failed` com `wamid` correto.
- [ ] Templates CRUD: criar template marketing com BODY + 2 variaveis e 2 buttons QUICK_REPLY -> aparece como `PENDING` -> apos aprovacao Meta, webhook atualiza status -> `template.status_changed` publicado.
- [ ] Upload de header media (`POST /uploads`) retorna handle reusavel.
- [ ] Profile: GET/PUT business profile funciona; upload de profile photo funciona.

### Tecnico

- [ ] `make typecheck` passa limpo.
- [ ] `make lint` passa limpo (Biome strict, zero warnings).
- [ ] `bun test packages/channel-whatsapp-cloud` passa com:
  - [ ] Fixture de webhook com `messages[].text` -> evento correto
  - [ ] Fixture de webhook com `statuses[].delivered` -> evento correto
  - [ ] Fixture de webhook com signature invalida -> rejeita 401
  - [ ] Idempotencia: mesmo `wamid` duas vezes -> apenas 1 evento publicado
  - [ ] Outbound text com numero E.164 -> payload Meta correto
  - [ ] Outbound template com variaveis -> payload com `components[].parameters` correto
- [ ] Plugin passa em `packages/channel-sdk/src/__tests__/compliance.test.ts`.
- [ ] OpenAPI atualizado (`/api/v2/openapi.json`) inclui as rotas novas.
- [ ] `make sdk-generate` regenera SDKs sem erros; tipos `WhatsappCloud*` aparecem em `packages/sdk/src/types.generated.ts`.
- [ ] Migration Drizzle gerada, SQL revisado, snapshot + journal commitados juntos.
- [ ] `bunx knip` nao reporta exports/imports orfaos no novo package.
- [ ] **Sentry `beforeSend` mascara texto de mensagem, telefones (E.164), `profile_name` e `access_token`** em events do plugin `whatsapp-cloud` — verificado com payload de teste capturado em snapshot (`packages/channel-whatsapp-cloud/src/__tests__/sentry-scrubbing.test.ts`).
- [ ] Rolling PR de `feat/whatsapp-cloud-channel` -> `dev` passa em todas checks de CI.

### Documental

- [ ] `packages/channel-whatsapp-cloud/CLAUDE.md` criado com padroes locais.
- [ ] `docs/channels/whatsapp-cloud.md` documentando: Embedded Signup setup, ENV vars, configuracao do webhook na Meta App, fluxo de templates, troubleshooting.
- [ ] Entrada `whatsapp-cloud` no README.md saindo do estado "Planned" para "New" / "Stable".
- [ ] `.env.example` atualizado.

### UX

- [ ] CreateInstanceModal habilita `whatsapp-cloud` e mostra wizard.
- [ ] Lista de templates com filtros (status, category) renderiza ate 500 templates sem travar.
- [ ] Erros de Meta sao traduzidos para mensagens humanas (ex: `131051` -> "Numero nao registrado, registre primeiro").

---

## Sub-tarefas Sugeridas (ordem de execucao)

### Grupo 1 — Schema & Types (fundacao)

- [ ] Adicionar colunas Meta em `packages/db/src/schema.ts::instances`.
- [ ] Criar tabela `whatsappTemplates` em `packages/db/src/schema.ts`.
- [ ] Rodar `bunx drizzle-kit generate` e revisar SQL.
- [ ] Definir Zod schemas compartilhados em `packages/core/src/schemas/whatsapp-cloud.ts` (apenas os transversais — payload do webhook, content types Meta-specific).
- [ ] Atualizar `packages/core/src/events/types.ts` se houver eventos novos (ex: `template.status_changed`).

**Validacao:** `make typecheck` + `make db-studio` mostra as novas tabelas.

---

### Grupo 2 — Plugin Skeleton + Cliente HTTP

- [ ] Criar `packages/channel-whatsapp-cloud/` com `package.json`, `tsconfig.json`, `src/index.ts`, `src/plugin.ts`, `src/capabilities.ts`.
- [ ] `src/client.ts` — `MetaWhatsAppClient` (fetch para `graph.facebook.com/{version}/{phone_number_id}`).
- [ ] `src/capabilities.ts` — `WHATSAPP_CLOUD_CAPABILITIES` (button=true, location=true, sticker=true, messagingWindow24h=true).
- [ ] Registrar plugin em `packages/api/src/services/index.ts` (onde os outros channels sao registrados).

**Validacao:** `cd packages/channel-whatsapp-cloud && bunx tsc --noEmit`.

---

### Grupo 3 — Outbound (senders)

- [ ] `src/senders/text.ts`, `src/senders/media.ts` (image/audio/video/document/sticker), `src/senders/location.ts`, `src/senders/contact.ts`, `src/senders/reaction.ts`, `src/senders/template.ts`.
- [ ] Dispatcher em `plugin.ts::sendMessage` que roteia por `content.type`.
- [ ] `src/utils/identity.ts` — normalizacao de telefones E.164.
- [ ] `src/utils/errors.ts` — mapeamento de codigos Meta -> `OmniError`.
- [ ] Testes unitarios de cada sender.

**Validacao:** `bun test packages/channel-whatsapp-cloud/src/__tests__/senders.test.ts`.

---

### Grupo 4 — Webhook Inbound

- [ ] `src/handlers/webhook.ts` — verificacao GET + processamento POST.
- [ ] `src/utils/signature.ts` — verificacao HMAC-SHA256 timing-safe.
- [ ] Parser para `messages[]` (text, image, audio, video, document, sticker, location, contacts, interactive button_reply, interactive list_reply, reaction).
- [ ] Parser para `statuses[]` (delivered, read, failed, sent + errors[]).
- [ ] Parser para `message_template_status_update`.
- [ ] Idempotencia via `createInboundDedupeCache` keyed por `wamid`.
- [ ] Registrar rota publica em `packages/api/src/app.ts` (espelhar bloco do gupshup em :217).

**Validacao:** `bun test packages/channel-whatsapp-cloud/src/__tests__/webhook.test.ts` com fixtures reais.

---

### Grupo 5 — OAuth + Conexao

- [ ] `src/oauth.ts` — `exchangeCodeForToken`, `getWabaDetails`, `registerPhoneNumber`, `subscribeApp`.
- [ ] `packages/api/src/routes/v2/whatsapp-cloud.ts` — endpoints OAuth + connect + profile + analytics + quality.
- [ ] Lifecycle `connect()` / `disconnect()` em `plugin.ts` chama oauth + persiste no banco.
- [ ] Health check (`getHealth`) — ping em `GET /{phone_number_id}` valida access_token.
- [ ] CLI: estender `omni instances connect <id>` para aceitar `--access-token` + `--phone-number-id` + `--waba-id` (modo manual; usa o endpoint `/whatsapp-cloud/connect`). Sem comando novo dedicado.

**Validacao:** integration test com mock do Graph API.

---

### Grupo 6 — Templates HSM

- [ ] `src/templates.ts` — CRUD via Graph API (`POST /{waba_id}/message_templates`, `DELETE`, `GET`).
- [ ] `packages/api/src/routes/v2/templates.ts` — endpoints CRUD + send + upload-header-media.
- [ ] Sync local <-> Meta (cron ou on-demand via `?sync=true`).
- [ ] Webhook `message_template_status_update` atualiza `whatsappTemplates.status`.
- [ ] Testes para componentes (HEADER text/image/video/document/location, BODY com placeholders, BUTTONS QUICK_REPLY/URL/PHONE_NUMBER/COPY_CODE).

**Validacao:** `bun test packages/channel-whatsapp-cloud/src/__tests__/templates.test.ts`.

---

### Grupo 7 — Frontend (apps/ui)

- [ ] `useFacebookSDK.ts` (port do TalkFlow).
- [ ] `WhatsAppCloudConnect.tsx` (wizard com Embedded Signup + manual).
- [ ] Habilitar `whatsapp-cloud` em `CreateInstanceModal.tsx`.
- [ ] Pagina/aba de templates com lista + filtros + builder + preview.
- [ ] Regenerar SDK (`make sdk-generate`) e usar tipos nas chamadas.

**Validacao:** `make dev-ui` -> fluxo completo manual + `make build-ui` limpo.

---

### Grupo 8 — Docs + Quality Gate

- [ ] `packages/channel-whatsapp-cloud/CLAUDE.md`.
- [ ] `docs/channels/whatsapp-cloud.md` (setup Meta App, ENV, troubleshooting).
- [ ] `.env.example` atualizado (`META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_WEBHOOK_BASE_URL`).
- [ ] README.md: badge "channels-3" -> "channels-4" e WhatsApp Cloud API saindo de Planned.
- [ ] **Auditar `beforeSend` em `packages/api/src/instrument.ts`** e estender scrubbing para mascarar campos do payload Meta: `text` (mensagem), telefones E.164 (`from`, `to`, `display_phone_number`, `phone_number`), `profile_name`, e `access_token` em qualquer error context. Adicionar fixture em `packages/channel-whatsapp-cloud/src/__tests__/sentry-scrubbing.test.ts` que captura um event simulado e verifica que nenhum dos campos sensiveis vaza.
- [ ] `make check` (typecheck + lint + test) verde.
- [ ] `bunx knip` limpo.
- [ ] Atualizar `.genie/wishes/_SHIPPED.md` ao concluir.

---

## Referencias

### TalkFlow (origem)

- `talkflow_backend/src/integrations/meta_oauth_service.py`
- `talkflow_backend/src/integrations/meta_template_service.py`
- `talkflow_backend/src/integrations/meta_whatsapp_client.py`
- `talkflow_backend/src/integrations/whatsapp_config_manager.py` (esp. `save_meta_config`, `get_meta_config_by_phone_id`, `_ensure_connections_format`)
- `talkflow_backend/src/integrations/whatsapp_client_factory.py`
- `talkflow_backend/src/api/meta_whatsapp_routes.py`
- `talkflow_backend/src/api/meta_template_routes.py`
- `talkflow_backend/src/api/meta_webhook_routes.py`
- `talkflow_backend/src/database/models.py::MetaTemplate` (linha 599)
- `talkflow_backend/guide/WHATSAPP_INTEGRATION.md`
- `talkflow_frontend/src/hooks/useFacebookSDK.ts`
- `talkflow_frontend/src/api/endpoints/metaWhatsapp.ts` + `metaTemplates.ts`
- `talkflow_frontend/src/features/whatsapp/`

### Omni (destino)

- `packages/channel-gupshup/` — referencia principal (webhook-based, REST outbound, similar a Cloud API).
- `packages/channel-sdk/src/types/plugin.ts` — interface `ChannelPlugin`.
- `packages/channel-sdk/src/base/BaseChannelPlugin.ts` — classe base.
- `packages/api/src/app.ts:217` — padrao de mount de webhook publico.
- `packages/api/src/routes/v2/instances.ts:495` — entrada estatica `whatsapp-cloud` ja existente.
- `packages/db/src/schema.ts:606` — tabela `instances`.
- `packages/core/src/types/channel.ts:7` — `whatsapp-cloud` ja registrado.
- `packages/core/src/automations/follow-up/capabilities.ts:54` — `messagingWindow24h: true` ja declarado.
- `apps/ui/src/components/instances/CreateInstanceModal.tsx:62` — entrada com `disabled: true`.
- `docs/architecture/plugin-system.md:1276` — config esperada do plugin.
- `packages/db/src/schema.ts:643` — campo `webhookVerifyToken` (per-instance, usado por Gupshup). **Nao reusar** para Meta — Meta usa token global via env `META_VERIFY_TOKEN`.
- `packages/channel-gupshup/src/handlers/webhooks.ts:189-200` — padrao de verificacao de token por query param (`?token=`). Meta usa estrategia diferente: validacao GET (`hub.verify_token`) + HMAC POST (`X-Hub-Signature-256` com `META_APP_SECRET`).
- `packages/api/src/instrument.ts:16-24` — `beforeSend` Sentry atual; alvo da auditoria de scrubbing nesta wish.

### Meta Graph API

- Cloud API reference: https://developers.facebook.com/docs/whatsapp/cloud-api
- Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup
- Message Templates: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Webhook signature: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validating-payloads
- Phone Number Registration: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
- Versao alvo: `v25.0` (mesma do TalkFlow). Atualizar antes do merge se a Meta lancar versao mais nova.

---

## Debito Tecnico (assumido por esta wish, tratado em wish futura)

- **Encryption at-rest de tokens de channels**: `metaAccessToken` armazenado em texto plano em `instances` (paridade com `discord_bot_token`, `telegram_bot_token`, `gupshupAuthToken`). Wish futura cobrira todos os tokens de uma vez com `OMNI_ENCRYPTION_KEY` (KMS-style envelope encryption). Nao bloqueia esta release.
