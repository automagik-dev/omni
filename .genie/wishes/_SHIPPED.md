# Shipped Wishes Audit

This file is the source of truth for which wishes in `.genie/wishes/` have already landed in the codebase. Tools and agents should skip any wish listed here when scanning the backlog — they're kept on disk for historical reference only.

Last audited: **2026-04-05** by `omni` orchestrator.

## Shipped (landed in dev/main)

| Wish slug | Shipped via | Notes |
|-----------|-------------|-------|
| `channel-error-migration` | PR #318 (dream-ch-errors) | Channel-prefixed error codes, sanitized API contexts, typed Telegram errors |
| `chat-attention-system` | shipped 2026-03-10 | lastMessageFromMe, visibility, labels on chats table |
| `feat-mark-online-configurable` | PR #315 | markOnlineOnConnect per instance |
| `fix-automation-pairing` | PR #326 | Event metadata, sendMessage dep wired, access.pairing_approved |
| `fix-contacts-pushname-missing` | PR #317 | Contact enrichment from platform_identities |
| `fix-debounce-message-drops` | PR #313 | Typing race no longer causes double dispatch |
| `fix-dm-context-and-quoted-truncation` | PR #226 + issue #223 closed | DM context enabled, quoted truncation raised |
| `fix-genie-client-autospawn-cwd` | PR #237 | No hardcoded ~/workspace override |
| `fix-group-name-null-fallback` | PR #316 | JID-based fallback for null group names |
| `fix-inbox-bridge-sanitization` | PR #314 | Outbound text sanitized in inbox-bridge relay |
| `fix-omni-bugs-243-244` | PR #253 | API key chat scoping + event-driven media pipeline |
| `fix-omni-minibugs-245-246-247` | PR #248 | JID normalization, CLI JSON output, media key warnings |
| `fix-whatsapp-edit-long-messages` | issue #224 closed | WhatsApp edit resolver fixed |
| `genie-session-passthrough` | PR #241 | --session passed to genie spawn |
| `group-members-with-names` | PR #328 | fetchGroupMembers on SDK |
| `md-simplification` | shipped 2026-03-26 | Pruned 9 dead .md files |
| `omni-docs-cleanup` | PR #255, #258 | All 25 CLI groups documented, AGENT_ROUTING.md rewritten |
| `omni-dx-quick-fixes` | PR #325 | channels.ts CLI registration + "Omni v2" → "Omni" rename |
| `remove-baileys-logger-from-core` | PR #194 | Dead Baileys logger adapter deleted |
| `route-config-overrides` | PR #254 | 14 override columns on agent_routes |
| `sdk-compliance-tests` | PR #229 | Compliance test suite landed |
| `sdk-compliance-test-suite` | duplicate of `sdk-compliance-tests` | Same work, different framing |
| `sentry-integration` | shipped 2026-03-10 | @sentry/bun with PII scrubbing |
| `standardize-sendtyping` | PR #196 | Auto-refresh typing in Discord/Telegram |
| `fix-nats-genie-reply-subscription` | PR #342 | Wire onReply + startReplySubscription on NatsGenieProvider |
| `fix-omni-mini-bugs-330-336-338` | PR #343 | vCard waid (#330), reaction echo loop (#336), connect typo (#338) |
| `fix-gupshup-quality-gate` | PR #334 | Gupshup channel plugin shipped with knip + compliance fixes |
| `fix-quick-wins-344-345-335` | PR #346 | JID self-filter (#344), NATS retry (#345), /health redirect (#335) |
| `fix-person-deduplication` | PR #348 | resolvedSenderPhone for LID linking, cross-instance matching, migration, orphan cleanup |
| `omni-agentic-cli` | PR #349 | Turn-based execution mode, 9 multimodal verbs, provider framework, instance scoping, persons CLI |

## Stale / Superseded (archive candidates)

| Wish slug | Reason |
|-----------|--------|
| `omni-backlog-sprint` | Vague epic; individual wishes now cover each bundled fix |
| `omni-finish-line` | Vague epic; partially shipped via PR #257; remaining scope covered by #284 |
| `omni-genie-integration-v2` | Fully shipped via PR #333 + #342. Provider + reply subscription complete. |

## Active (in progress right now)

(none — all teams shipped)

## Still Open (not started, not archived)

| Wish slug | Priority | Notes |
|-----------|----------|-------|
| `sentry-mcp` | P2 | Sentry SDK + MCP integration. Thorough research complete (DRAFT.md 275 lines). Ready to crystallize → wish. |
| `channel-plugin-generator` | P4 | Scripts/create-channel.ts skeleton (issue #92 closed) |
| `omni-skills-sync` | P4 | Create omni-agents/omni-providers skills. Full WISH.md exists, 4 groups. |
| `fix-server-version` | P5 | API version stuck at 2.0.0-dev.1 |
| `remove-channel-leaks-from-core` | P5 | 8 dead Discord/Slack columns (issue #88 closed) |

Note: P1 issues (#344 JID self-filter, #345 NATS retry, #335 health redirect) all shipped via PR #346.
