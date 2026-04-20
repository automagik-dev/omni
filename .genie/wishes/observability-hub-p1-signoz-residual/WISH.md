# Wish: observability-hub P1 — SigNoz backend residual bootstrap

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `observability-hub-p1-signoz-residual` |
| **Date** | 2026-04-20 |
| **Parent design** | [observability-hub DESIGN.md](../../brainstorms/observability-hub/DESIGN.md) |
| **Branch** | `chore/observability-hub-p1-signoz-residual` (to create from `dev`) |
| **Depends on** | — (standalone, ~30min of work) |
| **Blocks** | P2 group 2.7 (alert rules) reads/writes against this live backend |
| **Deployment target** | SigNoz Community EE v0.119.0 @ `10.114.1.173` (our current operational pick) |

## Summary

Finish the P1 bootstrap of our current OTLP backend (SigNoz) that was mostly completed during brainstorm. SigNoz is already deployed and ingesting; this wish closes the three residual operator tasks: create Discord alert channel via API, create a smoke-test alert rule, verify end-to-end trigger delivery. Everything in this wish targets our SigNoz deployment operationally — no producer code, no upstream PRs.

## Scope

### IN

- Create Discord webhook + target channel (e.g. `#observability-alerts`), URL captured to `/home/genie/.omni/signoz-keys.env`
- Create SigNoz notification channel via `POST /api/v1/channels` (type: `webhook` or `slack`-compatible) pointing at the Discord webhook
- Create smoke-test alert rule via `POST /api/v1/rules` — threshold that fires when a span arrives with attribute `test=true` and `service.name=observability-hub-smoke`
- Force trigger: send an OTLP span with `test=true` → verify Discord receives message in <2min
- Document in `/home/genie/.omni/signoz-keys.env` (already perms 600): channel ID, rule ID, webhook URL
- Runbook entry in `.genie/brainstorms/observability-hub/` sibling (e.g., `runbook-p1.md`): how to reach SigNoz, how to re-run the smoke test, how to rotate keys

### OUT

- Any producer code changes (those live in P2)
- WorkOS reverse-proxy (deferred until khal-os Platform ready)
- Additional alert rules beyond the smoke test (those live in P2 group 2.7 — silent-failure detection needs real producer signals first)
- Dashboard imports (deferred to P2.5)
- Backfill of historical data
- Ingestion key management (Community EE doesn't use them; resource attributes are the isolation layer)

## Decisions

| Decision | Rationale |
|----------|-----------|
| Discord primary alert channel | Reliable, independent of production stack (WhatsApp dogfood secondary, not MVP) |
| Admin Service Account Key used for all `/api/v1/*` automation | EE v0.119 aboliu PATs. Header: `SIGNOZ-API-KEY: <key>` |
| Smoke rule uses a synthetic attribute filter (`test=true`) | Prevents the rule from firing on real traffic later |
| Runbook lives with the brainstorm | Keeps operator docs versioned alongside design |
| No WorkOS reverse-proxy yet | LAN-only access via `10.114.1.0/24` is acceptable until khal-os Platform ships |

## Success Criteria

- [x] (Pre-done in brainstorm) SigNoz reachable `http://10.114.1.173:8080`, v0.119.0 EE, admin `cezar@namastex.ai` logged
- [x] (Pre-done) OTLP ingestion validated: trace `0d437778cdea850794c90132d0126482` queryable via `/api/v1/traces/{id}` and `/api/v3/query_range`
- [x] (Pre-done) Admin service account key saved to `/home/genie/.omni/signoz-keys.env` (perms 600)
- [ ] Discord webhook created (URL in env file)
- [ ] SigNoz notification channel created via `POST /api/v1/channels`, channel ID persisted
- [ ] SigNoz smoke-test rule created via `POST /api/v1/rules`, rule ID persisted
- [ ] Force trigger: synthetic span with `test=true` → Discord message arrives in <2min
- [ ] Runbook written with: URL, how to re-run smoke, how to rotate Service Account Keys, firewall notes

## Execution Groups

Single group — all tactical API calls sequenced linearly.

### G1 — Channel + Rule + Smoke Validation

1. User creates Discord webhook, pastes URL
2. Engineer runs `curl -H 'SIGNOZ-API-KEY: ...' -X POST http://10.114.1.173:8080/api/v1/channels -d '{...}'` with webhook URL → save channel ID
3. Engineer creates rule: `POST /api/v1/rules` with threshold `count(spans where test=true) > 0 in last 1min` → save rule ID
4. Force trigger: send OTLP span with `test=true`
5. Verify Discord receives alert within 2min
6. Write runbook

## Non-goals

- Any producer changes (live in P2)
- Dashboard imports
- Long-retention configuration
- WorkOS / external auth

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| SigNoz `/api/v1/channels` schema varies by EE version | Low | Validate with `GET /api/v1/channels` first to see existing shape; reference SigNoz v0.119 docs if needed |
| Discord rate-limits the webhook under storm | Low | Smoke test is a single fire; not a storm scenario |
| Rule condition syntax differs in EE | Low | Test with minimal condition first; escalate to simpler threshold if needed |

## References

- Parent DESIGN: [`.genie/brainstorms/observability-hub/DESIGN.md`](../../brainstorms/observability-hub/DESIGN.md)
- Admin key storage: `/home/genie/.omni/signoz-keys.env` (600, not in git)
- Smoke test evidence: trace ID `0d437778cdea850794c90132d0126482`
