# Validating `@omni/channel-msteams`

How a human validates the Microsoft Teams channel plugin, from fully offline
to a real Teams end-to-end run.

## What this scaffold supports

| Area | Status |
| --- | --- |
| Inbound text (`message.received`, with dedupe, sanitization, journey timings) | ✅ |
| Outbound text via `continueConversationAsync` (reply into a seen conversation) | ✅ |
| Webhook authenticity (Bot Framework JWT validated by the CloudAdapter) | ✅ |
| ConversationReference capture (DMs, group chats, channels — bounded to 1000/instance) | ✅ |
| Credential validation at the boundary (Zod, `MsTeamsConfigSchema`) | ✅ |
| Media (send/receive), reactions, typing indicator, message edit/delete | ⛔ follow-up |
| Adaptive Cards / buttons, streaming responses | ⛔ follow-up |
| Proactive messaging to conversations the bot has never seen | ⛔ follow-up (needs Graph install-lookup) |
| Credential persistence + auto-reconnect after API restart | ⛔ follow-up (see "Credentials at rest" below) |

## Credentials at rest — read this first

The Azure Bot `appPassword` is accepted **at connect time only**
(`POST /api/v2/instances/:id/connect` with `msteamsAppPassword`) and held in
memory. There is no sealed `instances` column for it yet, so it is **never
persisted** — after an API restart the instance stays disconnected until an
operator reconnects with the secret, and the instance monitor deliberately
skips auto-reconnect for `msteams`. Non-secret identifiers (`appId`,
`appType`, `tenantId`) may be persisted under `profileMetadata.msteams`
(create/PATCH the instance with
`{"profileMetadata": {"msteams": {"appId": "...", "appType": "...", "tenantId": "..."}}}`);
never put the `appPassword` there — `profileMetadata` is returned by the API.

## Level 0 — offline (no account, no network)

```bash
cd packages/channel-msteams && bun test
```

The unit suite runs every path against a faked CloudAdapter: Zod credential
boundary, webhook routing/JWT-rejection/dedupe/sanitizer, ConversationReference
capture, both send paths (reference found / missing), Connector failure, and
disconnect cleanup. The SDK compliance matrix in
`packages/channel-sdk/src/__tests__/compliance.test.ts` also covers `msteams`.

## Level 1 — local emulator (no account)

The Bot Framework Emulator and the Teams App Test Tool send **unauthenticated**
requests, which the JWT-validating adapter would reject. For local runs only,
connect the instance in anonymous mode:

1. Start omni locally (`make dev`) and create an instance:
   `omni instances create --name teams-local --channel msteams`
2. Connect it anonymously (local dev ONLY — the webhook then trusts any caller
   that knows the URL; never do this on an internet-reachable deployment):

   ```bash
   curl -X POST localhost:PORT/api/v2/instances/<id>/connect \
     -H 'content-type: application/json' \
     -d '{"msteamsAllowAnonymous": true}'
   ```

3. **Bot Framework Emulator** ([github.com/microsoft/BotFramework-Emulator](https://github.com/microsoft/BotFramework-Emulator)):
   "Open Bot" → endpoint `http://localhost:PORT/api/v2/channels/msteams/<instanceId>/webhook`,
   leave App ID / password empty. Type a message: the plugin should emit
   `message.received` (visible via `omni events tail` / the dashboard), and an
   agent reply should render back in the emulator via the captured
   ConversationReference.
4. **Teams App Test Tool** (`npm`-less: `bunx @microsoft/teams-app-test-tool`)
   pointed at the same endpoint gives a Teams-styled chat UI over the same
   anonymous transport.

What this validates: routing, activity parsing, reference capture, the full
`message.received → dispatcher → sendMessage` loop. What it does NOT validate:
JWT validation and token acquisition (both bypassed in anonymous mode).

## Level 2 — real Teams end-to-end

Requirements: an Entra ID tenant where you can create app registrations, an
Azure subscription for the Azure Bot resource (F0 tier is free), a Microsoft
365 tenant with permission to sideload custom apps, and an HTTPS tunnel to
your omni (e.g. `ngrok http PORT`). Generic steps — substitute your own
tenant/host values:

1. **Entra app registration**: portal.azure.com → App registrations → New.
   Single-tenant or multi-tenant; record the Application (client) ID and the
   Directory (tenant) ID, and create a client secret (record its value).
2. **Azure Bot resource** (pricing tier F0): "Type of App" matching step 1,
   using the same App ID. Set the messaging endpoint to
   `https://<your-tunnel-host>/api/v2/channels/msteams/<instanceId>/webhook`.
3. In the Azure Bot resource, open **Channels** and add the
   **Microsoft Teams** channel.
4. **Teams app package**: a minimal `manifest.json` with a `bot` entry whose
   `botId` is the App ID and scopes `["personal", "team", "groupChat"]`, plus
   the two icon PNGs, zipped. (Teams Toolkit or
   [dev.teams.microsoft.com](https://dev.teams.microsoft.com) can generate
   this.) In Teams: Apps → Manage your apps → Upload a custom app (requires
   the tenant's custom-app sideload policy to allow it).
5. **Connect the omni instance** with the real credentials:

   ```bash
   curl -X POST localhost:PORT/api/v2/instances/<id>/connect \
     -H 'content-type: application/json' \
     -d '{
       "msteamsAppId": "<application-client-id>",
       "msteamsAppPassword": "<client-secret-value>",
       "msteamsAppType": "SingleTenant",
       "msteamsTenantId": "<directory-tenant-id>"
     }'
   ```

   (`msteamsAppType: "MultiTenant"` and no `msteamsTenantId` for multi-tenant
   registrations.)
6. **Validate inbound**: message the bot in Teams (personal chat, and again
   from a group chat / channel — @mention the bot there). Each message should
   land as `message.received` with the mention stripped, and requests with a
   bad/absent JWT (e.g. `curl` straight at the webhook) must get a 401.
7. **Validate outbound**: with an agent wired to the instance, the reply
   should arrive in the same Teams conversation. A send to a conversation the
   bot has never seen must fail with
   `MSTEAMS_NO_CONVERSATION_REFERENCE` — expected scaffold behavior.
8. **Restart behavior**: restart the API and confirm the instance reports
   disconnected and does NOT auto-reconnect (by design — step 5 reconnects it).
