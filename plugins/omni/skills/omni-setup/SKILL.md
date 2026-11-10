---
name: omni-setup
description: "Configure an existing Omni or install a local runtime, connect a channel, wire an agent, and verify."
allowed-tools: Bash(omni *), Bash(genie *)
---

# Omni Setup

## When to Use

Register or install Omni, sign in, pair a channel, or connect an agent backend.

## Flow

1. Read `omni --help` and the requested command's help before using it. Read [ground rules](../omni-ops/references/ground-rules.md) and [setup details](references/setup.md) for credential, pairing and runtime boundaries.
2. Choose the user's target: an existing server or an explicitly requested local install. Inspect the server registry before changing it; check reachability and credentials separately. An auth denial is not evidence that a local server is needed.
3. For an existing server, discover registration and sign-in through `omni server --help` and `omni auth --help`. Device sign-in needs an interactive terminal and owner approval; scripts use protected credential input as described in the reference.
4. Only for a requested local install, inspect `omni install --help` and the installed help for the intended runtime. Install or start services only with authorization, then verify that runtime's health.
5. Inspect existing instances before provisioning. Discover channel setup with `omni channels --help` and pairing with `omni instances --help`; complete the intended channel's connection ceremony and confirm its status.
6. Inspect existing providers and agents before wiring a backend. Read `omni setup agent --help` for supported schemas and required flags; use the actual backend's documented contract. Provider health alone does not prove replies work.
7. For Genie integration, run `genie --version` and `genie --help` first. **Contract checked: Genie 6.261109.1 (2026-11-10)** exposes no Omni bridge or directory interface. This installation cannot support the old Genie wiring recipe. Report that incompatibility; use another compatible backend only when requested. For a different Genie version, verify its advertised integration and runtime instructions before using `omni connect --help` for wiring. Connect configures Omni records; it does not start or verify an external bridge.
8. Read back the instance's agent binding and reply filter. With authorization, send a test through the intended channel and observe the reply there. Report saved configuration, runtime health and delivered replies separately.

## Rules

- Installed help is the authority. If a command or required interface is absent, report the version and missing capability; do not invent commands, NATS topics or a bridge launcher.
- Preserve the selected server and intended instance. Never install, restart or switch runtimes to work around missing credentials or scopes.
- Use protected input or a secret manager for credentials; never request keys in chat or paste values into commands. Agent hosts need their own bounded event-access pairing flow (reference).
- Pairing, operator approval, agent wiring, service changes and test sends require the user's authorization. Discovery grants none of these permissions.
- For turn-based dispatch, preserve the bridge's conversation context and close the turn through the [agent skill](../omni-agent/SKILL.md).
