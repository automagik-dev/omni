# Wish Index

> Inventory of all wish documents. **89 wishes total.** Last updated: 2026-02-11

## Current Sprint Plan (Sofia-validated, Feb 11)

### 🔴 Sprint 1 — This Week (Feb 12-14)
| Bead | Wish | Title | Status |
|------|------|-------|--------|
| `omni-q01` | [provider-system-refactor](provider-system-refactor/provider-system-refactor-wish.md) | Provider System Refactor (generic IAgentProvider) | READY |
| `omni-m17` | [telegram-channel-activation](telegram-channel-activation/telegram-channel-activation-wish.md) | Telegram Activation — persist tokens, auto-reconnect, CLI | READY |

### 🟡 Sprint 1.5 — Next Week (Feb 17-21)
| Bead | Wish | Title | Status |
|------|------|-------|--------|
| `omni-v10` | [claude-code-provider](claude-code-provider/claude-code-provider-wish.md) | Claude Code Agent Provider | blocked by q01 |
| `omni-s8k` | [ag-ui-protocol](ag-ui-protocol/ag-ui-protocol-wish.md) | AG-UI Protocol Support | READY |

### 🟢 Sprint 2 — Feb 24+
| Bead | Wish | Title | Status |
|------|------|-------|--------|
| `omni-3an` | [media-serving](media-serving/media-serving-wish.md) | Media Download & Serving via API | READY |
| `omni-70d` | [media-auto-processing](media-auto-processing/media-auto-processing-wish.md) | Automatic Media Processing | blocked by 3an |
| `omni-j5h` | [whatsapp-groups-core-controls](whatsapp-groups-core-controls/whatsapp-groups-core-controls-wish.md) | WhatsApp Groups Core Controls | READY |

---

## Summary

- **✅ Shipped**: 56
- **📝 Active Backlog**: 33 (10 ready, 3 blocked, 8 deferred)

---

## Full Active Backlog

### P1 — Critical Path
| Bead | Title | Sprint | Blocked? |
|------|-------|--------|----------|
| `omni-q01` | Provider System Refactor | current | — |
| `omni-m17` | Telegram Channel Activation + CLI | current | — |
| `omni-v10` | Claude Code Agent Provider | next | by q01 |
| `omni-s8k` | AG-UI Protocol Support | next | — |
| `omni-td4` | Media Processing Pipeline v2 (epic) | — | — |
| `omni-jja` | LID as first-class identifier | — | — |

### P2 — Important
| Bead | Title | Sprint | Blocked? |
|------|-------|--------|----------|
| `omni-3an` | Media Download & Serving via API | 2 | — |
| `omni-70d` | Automatic Media Processing | 2 | by 3an |
| `omni-6ek` | trigger_logs Writer | — | — |
| `omni-3ys` | Provider Schemas Single Source of Truth | — | — |
| `omni-eef` | Message Journey Tracing | — | — |
| `omni-16n` | Media "Drive Mode" | — | — |
| `omni-bsa` | MCP Server | — | by a8p |
| `omni-b2t` | CLI Instance Sessions Debugging | — | — |
| `omni-but` | Refactor omni_events to lean event log | — | — |
| `omni-gt7` | CI/CD Pipeline | — | — |
| `omni-a8p` | Omni Skill for AI Assistants | — | — |
| `omni-tth` | API Key Audit Trail | — | — |
| `omni-pyt` | Agent Routing | — | — |
| `omni-bkh` | Agent Auto-Replay on Reconnect | — | — |
| `omni-73i` | Test isolation: provider cache reset | — | — |
| `omni-7pf` | Provider cache invalidation | — | — |
| `omni-0rw` | BufferedMessage full OmniEvent envelope | — | — |
| `omni-j5h` | WhatsApp Groups Core Controls | 2 | — |
| `omni-b29` | WhatsApp Groups Admin Controls | — | — |
| `omni-f99` | WhatsApp Groups Full Parity | — | — |
| `omni-t4u` | S3 storage backend | — | — |
| `omni-fu8` | Discord media local download | — | — |

### P3-P4 — Deferred (per Sofia)
| Bead | Title | Verdict |
|------|-------|---------|
| `omni-dq9` | Enterprise Compliance (GDPR/SOC2) | DEFER 6+ months |
| `omni-rx3` | PIX Button Research | DROP |
| `omni-4ek` | WebSocket Event Streaming | DEFER |
| `omni-ucs` | WhatsApp Newsletters | DEFER |
| `omni-c85` | WhatsApp Business Cloud API | DEFER 3 months |
| `omni-89y` | Gmail Channel | DEFER |
| `omni-beb` | Session Observatory | DEFER |
| `omni-5ks` | Omni as Native Agent | DEFER |
| `omni-d0o` | S3/R2 cloud storage | DEFER |
| `omni-vq7` | CLI wss:// TLS hints | DEFER |

---

<details>
<summary><strong>✅ Shipped (56 wishes)</strong></summary>

| Slug | Title | Bead |
|------|-------|------|
| access-rules-testing | Access Rules Testing | `omni-m5n` |
| agent-providers-impl | AgnoOS Provider Integration | `omni-r76` |
| api-completeness | API Completeness | `omni-cju` |
| api-key-security | API Key Security | `omni-axi` |
| api-performance | API Performance Optimization | `omni-e5p` |
| api-setup | API Setup | `omni-v2-xtv` |
| automation-improvements | Automation Condition Logic (OR) | `omni-agi` |
| automation-testing | Automation Testing | `omni-tjw` |
| baileys-esm-fix | Baileys ESM Fix | `omni-9q2` |
| baileys-quick-wins | Baileys Quick Wins (B1-B6) | — |
| call-agent-action | call_agent Automation Action | `omni-b48` |
| channel-discord | Channel Discord | `omni-v2-6zm` |
| channel-integration | Channel Integration | `omni-v2-d2x` |
| channel-sdk | Channel SDK | `omni-v2-5v7` |
| channel-telegram | Telegram Bot API Channel | `omni-gry` |
| channel-whatsapp | Channel WhatsApp | `omni-v2-aqp` |
| cli-chat-ux | CLI Chat UX | `omni-ndl` |
| cli-dx-improvements | CLI DX Improvements (A1-A5) | — |
| cli-setup | CLI Setup | `omni-v2-clg` |
| cli-ux | CLI UX Improvements | `omni-ndl` |
| contacts-groups-sync | Contacts & Groups Sync | `omni-lgs` |
| dashboard-api-enhancements | Dashboard API Enhancements | `omni-kmw` |
| discord-interactivity | Discord Interactivity | `omni-ras` |
| dx-setup | DX Setup Improvements | `omni-6mf` |
| events-ext | Events Ext | `omni-v2-ds9` |
| events-ops | Events Ops | `omni-v2-gwb` |
| fix-ui-typecheck | Fix UI Typecheck | — |
| foundation | Project Foundation | `omni-v2-8wd` |
| git-history-secret-cleanup | Git History Secret Cleanup | `omni-8j6` |
| group-create | WhatsApp Group Create | — |
| history-sync | History Sync | `omni-rnc` |
| humanized-action-delay | Humanized Action Delay | — |
| identity-auto-link | Identity Auto-Link | `omni-dk0` |
| khal-smart-response-gate | Khal Smart Response Gate | — |
| media-processing-batch | Media Processing Batch | `omni-ap0` |
| media-processing-realtime | Media Processing Realtime | `omni-1mj` |
| medium-features | Medium Features (C1-C7) | `omni-1s0` |
| message-resilience | Message Resilience | `omni-2q2` |
| nats-events | NATS Events | `omni-v2-6p2` |
| omnichannel-agent-platform | Omnichannel Agent Platform | `omni-hjx` |
| openapi-sync | OpenAPI Sync | `omni-b86` |
| openclaw-provider-integration | OpenClaw Provider Integration | `omni-6vk` |
| openclaw-review-fixes-r2 | OpenClaw Provider R2 Fixes | `omni-ui7` |
| pr13-review-fixes | PR #13 Review Fixes | `omni-blj` |
| sdk-expansion | SDK Expansion | `omni-db7` |
| sdk-generation | SDK Generation | `omni-v2-0cy` |
| sdk-multilang | Multi-Language SDK | `omni-q0z` |
| send-complete | Send Complete | `omni-y51` |
| send-tts | Send TTS (ElevenLabs) | `omni-soi` |
| telegram-rawpayload-alignment | Telegram rawPayload Alignment | `omni-ou4` |
| ui-dashboard-v2 | UI Dashboard V2 | `omni-2j8` |
| ui-foundation | UI Foundation | `omni-0yx` |
| ui-project-setup | UI Project Setup | `omni-j2s` |
| unified-logging | Unified Logging | `omni-72g` |
| unified-messages | Unified Messages | `omni-p5c` |
| whatsapp-openclaw-integration-test | WhatsApp↔OpenClaw Test | `omni-eke` |

</details>

---

## Wish Lifecycle

```
DRAFT → APPROVED → IN_PROGRESS → REVIEW → SHIPPED
```

## Commands
- `/wish` — Plan a new feature
- `/forge` — Execute an approved wish  
- `/review` — Validate completed work
