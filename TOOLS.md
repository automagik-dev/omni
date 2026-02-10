# TOOLS.md - Local Notes

_My actual environment. The stuff that's unique to this setup._

---

## Infrastructure

- **Host:** genie-os (Linux, Proxmox VM)
- **Repo:** `/home/genie/workspace/repos/automagik/omni` (github.com/automagik-dev/omni.git)
- **Runtime:** Bun (NOT npm/node/yarn — ever)

## tmux

- **Session:** `genie` (6 windows)
- **Window 0 "OMNI":** pane %0 (OpenClaw/me) + pane %1 (Claude Code via `claudio`)
- **Pane targeting:** `tmux send-keys -t %1 "command" Enter` / `tmux capture-pane -t %1 -p`

## SSH Hosts

| Alias | Host | Notes |
|-------|------|-------|
| `demo-khal` | 216.238.114.83:8022 | Demo server |
| `cegonha` | 10.114.1.121:22 | Linux node (paired) |
| `stefani` | 10.114.1.124:22 | — |
| `gus` | 10.114.1.126:22 | — |
| `felipe-mac` / `mac` | 192.168.112.30 (user: feliperosa) | Felipe's MacBook (paired) |

## Paired Nodes

- **Cegonha** — Linux, capabilities: browser, system
- **Felipe-MacBook** — macOS (darwin), capabilities: browser, system

## PM2 Services

- `khal-server` (id: 0) — separate project, running alongside
- `khal-frontend` (id: 1) — separate project, running alongside

## Omni Packages

```
packages/
├── api/               # HTTP API (Hono + tRPC + OpenAPI)
├── channel-discord/   # Discord channel plugin
├── channel-sdk/       # Plugin SDK for channel developers
├── channel-whatsapp/  # WhatsApp channel plugin
├── cli/               # LLM-optimized CLI (not yet globally installed)
├── core/              # Events, identity, schemas
├── db/                # Database package
├── media-processing/  # Media handling
├── sdk/               # Auto-generated TypeScript SDK
├── sdk-go/            # Go SDK
└── sdk-python/        # Python SDK
```

## CLI

- `omni` CLI binary at `~/.omni/bin/omni` (pre-built, works)
- ⚠️ `make cli` / `bun packages/cli/src/index.ts` crashes (Bun 1.3.8 segfault) — use the binary
- `claudio` — launches Claude Code in tmux

## Omni Server (Remote)

- **URL:** `https://felipe.omni.namastex.io`
- **API:** v2.0.0, healthy
- **Auth:** key `omni_sk_85f91e2b...`, scopes `[*]`
- **Default instance:** `cdbb6ca3` (felipe-pessoal / WhatsApp)
- **Instances:**
  - `felipe-pessoal` — Felipe Rosa (WhatsApp)
  - `5511986780008` — Namastex Labs (WhatsApp)
  - `genie` — Genie - Chief of Khal (WhatsApp)
  - `charlinho-5511949788888` — Charlinho (WhatsApp)

## Common Make Targets

```bash
make dev              # Start all services + API
make check            # typecheck + lint + test
make restart-api      # Restart API only
make cli ARGS="..."   # Run CLI from source
make cli-link         # Build + link globally
```

## Bun Testing Gotchas

- **`mock.module()` is process-wide** — mocked names apply to ALL concurrent test files, not just the importing one
- **Only explicitly mocked names are replaced** — unmocked exports pass through from the real module
- **Don't mock shared utilities** (like `createLogger`) in one test if other concurrent tests depend on the real implementation
- **Test isolation:** Bun runs test files in parallel by default. Cross-file mock contamination is a real risk.

## GitHub README Resources

- `<details><summary>Title</summary>content</details>` — collapsible sections
- `<picture><img src="..."/></picture>` — light/dark mode images
- `<p align="center">` — centered content
- HTML `<table>` — side-by-side layouts (e.g., SDKs)
- Nav bar pattern: `[Link 1](#anchor) • [Link 2](#anchor) • [Link 3](#anchor)`

## Image Generation

- **Nano Banana Pro (Gemini):** `uv run /home/genie/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/skills/nano-banana-pro/scripts/generate_image.py --prompt "..." --filename "out.png" --resolution 1K`
- GEMINI_API_KEY configured in `~/.openclaw/openclaw.json`
- Good for: repo headers, logos, banners, diagrams

---

_Updated: 2026-02-10_
