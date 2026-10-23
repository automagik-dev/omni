# Omni AI for DSH

`@automagik/omni-ai-dsh` is the first thing a DeepSeek Harness (DSH) shows with Omni
installed: the Omni octopus says hello, then helps you connect an AI. It adds no provider
code. Every sign-in it offers is one DSH 0.2.1-rc.3 already ships, and the one route it
writes goes through DSH's own settings and credential store.

## What it does

Two steps on DSH's `settings.onboarding` slot, shown once each on a fresh start (a new
chat with nothing in it), ahead of DSH's own steps:

| Step | Order | What it shows |
|---|---|---|
| `omni-welcome` | −300 | The octopus, a typewriter speech bubble and a glitch, on a starfield. |
| `omni-connect-ai` | −200 | The Connect AI tiles, and Skip. |

The Omni plugin (`@automagik/omni-dsh`) adds `omni-connect` (−250) between them when it
is installed. DSH's `welcome-notice` (−100) and `deepseek-official` (0) follow.

Each step draws its own modal and makes `#root` inert while it shows. When you finish or
skip a step, the plugin records it in its own settings entry, `omni-ai`, in three live
fields (`welcomeDone`, `connectAiDone`, `connectOmniSkipped`), so the step does not come
back after a restart. A step whose flag is already set completes without showing.

The Connect AI tiles, API-key paths first:

| Tile | Leads to |
|---|---|
| DeepSeek | Settings → Models: DeepSeek's API key. (The account section exists only once an account is signed in, so it is not a place to send a new user.) |
| Z.ai, OpenCode, Any API key | Settings → Models: pi-ai's key prompt for that provider. |
| Codex, Claude, Kimi | Settings → Models: pi-ai's built-in sign-in. |
| CLIProxyAPI | A form for your gateway's address and key (see below). |

A tile that opens Settings completes the step first, so the modal never covers the
section it opened. Motion stops under `prefers-reduced-motion`.

### Subscription sign-ins and vendor terms

The Codex, Claude and Kimi sign-ins use a consumer plan through another CLI's sign-in.
Each tile says **Personal use under the vendor's terms**: check that provider's terms
before you use a personal plan for work. The API-key paths come first for that reason.

## Install into a raw DSH

The plugin needs DSH `>=0.2.1-rc.2 <0.3.0`. Add the Automagik marketplace index to DSH's
plugin market ([marketplace/README.md](../../marketplace/README.md) has the URL and the
steps) and install `@automagik/omni-ai-dsh` from it. DSH asks before it installs, then
applies the bundle patch (`cordis.patch.yml`), which adds one row, `id: omni-ai`, and
changes nothing else.

Restart DSH and start a new chat to see the octopus.

## The CLIProxyAPI route

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) serves an OpenAI-compatible
API for the providers you sign into on it. The form asks for its address (for example
`http://localhost:8317/v1`; an address without a path gets `/v1`) and its API key. On
Connect, the host:

1. Checks the address is `http://` or `https://`, with no user name, query or fragment.
2. Lists the gateway's models with `GET {baseURL}/models` and `Authorization: Bearer <key>`,
   without following redirects. An empty list refuses the save.
3. Stores the key with `ctx.credentials.set('OMNI_AI_CLIPROXY_API_KEY', key)`.
4. Writes the route into pi-ai's settings entry with
   `ctx.settings.update('llm-pi-ai', patch, revision)`, the revision read from
   `ctx.settings.describe()`:

   ```yaml
   providers:
     cliproxy:
       displayName: CLIProxyAPI
       api: openai-completions
       baseURL: http://localhost:8317/v1
       apiKeyEnv: OMNI_AI_CLIPROXY_API_KEY
       models:
         - { id: <model id>, name: <model id> }
   ```

The key never enters a settings file, a reply or a log: the route names it by the
env-shaped credential reference, which DSH resolves for each request. Saving again
replaces this route's model list and keeps every other route. Use `https://` for a
gateway that is not on your own machine, since the key travels with each request.

The shape was read from DSH 0.2.1-rc.2:

- `dsh-llm-pi-ai`: `Config = z.object({ providers: z.dict(profile).default({}).volatile() })`,
  where a profile has `apiKeyEnv` (a credential reference), `displayName`, `api`, `baseURL`
  and `models: [{ id, name, … }]`. Its README: a route pi-ai does not ship needs `api`,
  `baseURL` and a non-empty `models` list. The base bundle mounts it as entry `llm-pi-ai`.
- `dsh-settings`: `update(ns, patch, expectedRevision)` deep-merges plain objects and
  replaces arrays, so other routes stay and this route's `models` is replaced.
- `dsh-credentials`: a reference matches `/^[A-Za-z_][A-Za-z0-9_]*$/`.

## Host endpoint

`POST /api/omni-ai` with `{ endpoint, payload }`, answered `{ ok: true, value }` or
`{ ok: false, error: { code, message } }`:

| Endpoint | Payload | Does |
|---|---|---|
| `state` | none | The three flags; `deepseek` (a `DEEPSEEK_API_KEY` or a DeepSeek account sign-in is stored); `piAiRoutes`; `aiConnected`. |
| `done` | `{ stepId }` | Sets the flag for `omni-welcome`, `omni-connect-ai` or `omni-connect`. |
| `cliproxy` | `{ baseURL, apiKey }` | The route above; answers `{ route, baseURL, models }`. |

The host declares `inject: ['settings', 'credentials', 'connection']`; `connection` serves
the route.

## Develop

```sh
bun install          # esbuild, for the client bundle
bun run harness      # the pinned DSH release the tests and the linter run against
bun run test         # on Node, as DSH runs
bun run lint
bun run build        # rewrites client.js; commit it
node scripts/build-client.mjs --check
```

`client.js` is generated from `src/client` and committed, so git and `link:` installs need
no build step.
