# Omni AI for DSH

`@automagik/omni-ai-dsh` is the first thing a DeepSeek Harness (DSH) shows with Omni
installed: the Omni octopus says hello, then helps you connect an AI. It adds no provider
code. Every sign-in it offers is one DSH 0.2.1-rc.3 already ships, and every route it
writes goes through DSH's own settings and credential store.

## What it does

Two steps on DSH's `settings.onboarding` slot, shown once each on a fresh start (a new
chat with nothing in it), ahead of DSH's own steps:

| Step | Order | What it shows |
|---|---|---|
| `omni-welcome` | −300 | The octopus, a typewriter speech bubble and a glitch, on a starfield. |
| `omni-connect-ai` | −200 | Connect AI: one switch per AI, Continue and Skip. |

The Omni plugin (`@automagik/omni-dsh`) adds `omni-connect` (−250) between them when it
is installed. DSH's `welcome-notice` (−100) and `deepseek-official` (0) follow.

Each step draws its own modal and makes `#root` inert while it shows. When you finish or
skip a step, the plugin records it in its own settings entry, `omni-ai`, in three live
fields (`welcomeDone`, `connectAiDone`, `connectOmniSkipped`), so the step does not come
back after a restart. A step whose flag is already set completes without showing.

Connect AI is a list of switches, and several can be on. What this computer already has
comes first, under **Found on this computer**: Claude Code signed in, a key in DSH's store
or in the environment, a sign-in DSH already holds, a CLIProxyAPI route, Ollama answering
on `127.0.0.1:11434`. **Add another** shows four more, then the rest on demand. Continue
needs one AI really on; Skip finishes the step either way.

Flipping a switch on turns on what is set up, or opens its setup in the row: a key field,
the provider's own sign-in in DSH, or a terminal for Claude Code's own login. Off stops
using an AI and keeps its key, sign-in or account:

| Kind | On | Off |
|---|---|---|
| Key | writes the pi-ai route that names the key | removes the route; the key stays |
| Sign-in | the route is written once the sign-in succeeds | removes the route; the sign-in stays |
| Claude | enables the Claude Code plugin (`dsh-oh-my-claude`) in DSH's plugin manager | disables that plugin |
| CLIProxyAPI | the gateway form writes its route | removes the route; the key stays |
| Ollama | lists its models into a local OpenAI-compatible route | removes the route |
| dsh-subscriptions | shows the vendor's models again | hides them in that plugin's picker settings; the account stays |

DeepSeek is DSH's own route: its row turns on with a key or a DeepSeek account, and its key
is removed in Settings → Models. Every other provider DSH knows stays one link away, in
Settings → Models.

### One way to each AI

| AI | Through | Not offered |
|---|---|---|
| Claude | the Claude Code app (`dsh-oh-my-claude`), signed in with `claude auth login` | DSH's own Claude sign-in and dsh-subscriptions' `claude`: both present as Claude Code |
| ChatGPT | DSH's sign-in (`openai-codex`) | dsh-subscriptions' `codex` |
| Kimi | DSH's sign-in (`kimi-coding`) | dsh-subscriptions' `kimi` |
| Copilot | DSH's sign-in (`github-copilot`) | dsh-subscriptions' `copilot` |
| Grok | DSH's sign-in (`xai`), or an `XAI_API_KEY` | dsh-subscriptions' `grok` |
| DeepSeek | DSH's key or account | pi-ai's `deepseek` route |
| Ollama | a local pi-ai route | dsh-subscriptions' `ollama` |

dsh-subscriptions keeps the vendors nothing else reaches (Cursor, Kiro, GLM, Qwen,
Perplexity, JetBrains, Cody, Replit and the rest). When an AI is turned on, the other ways
it is connected stop showing: their models are hidden and DSH's Claude sign-in loses its
route, and no account or stored sign-in is deleted. A row says when its AI is also
connected another way.

### Subscription sign-ins and vendor terms

A sign-in with a consumer plan is **personal use under the vendor's terms**: check that
provider's terms before you use a personal plan for work.

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
| `ais` | none | Every row: `{ id, name, via, kind, ready, on, found, needs?, detail?, duplicates? }`, and dsh-subscriptions' accounts and hidden vendors. Names and states only. |
| `ai-switch` | `{ id, on }` | Turns a row that is set up on or off (table above). |
| `ai-dedupe` | `{ id }` | Stops the other ways that row's AI is connected. |
| `ai-subscription` | `{ provider, on }` | Shows or hides a dsh-subscriptions vendor's models. |
| `provider-key`, `signin-*` | see `src/host/providers.js` | A key, or a sign-in run through DSH's authorization service. |
| `ai-terminal-open`, `-read`, `-write`, `-resize`, `-close` | `{ kind: 'claude-login' }`, then the terminal id | The terminal that runs `claude auth login`, typed at a prompt and run with Enter. |

The host declares `inject: ['settings', 'credentials', 'connection']`; `connection` serves
the route. It reads DSH's `llm`, `authorization` and `pluginManager` services and its process
service (`subprocess`, for the terminal) when they are there.

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
