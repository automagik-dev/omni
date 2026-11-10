---
rfc: "0007"
title: "SaaS platform auth"
status: Draft
created: 2026-07-31
---
# RFC-0007: SaaS platform auth

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | Platform-session login for a multitenant Omni |
| Issue | No dedicated issue identified in the supplied snapshot |
| Design | [WISH](../../.genie/wishes/saas-platform-auth/WISH.md); direct plan, no separate DESIGN |
| Created | 2026-07-31 |

## Summary

In SaaS deployments, Omni validates KHAL platform sessions and offers a code-and-URL
login in the CLI and product UI. The platform remains the issuer; Omni integrates
its sessions with the existing tenant authority model. Single-tenant API-key
authentication remains supported.

**Happy delivery:** choose a SaaS Omni, approve its displayed login code in the platform, and return to Omni signed into the intended tenant without pasting an API key.

## Motivation

The named-server client work left human platform authentication as a separate
goal. The WISH is still DRAFT, with architecture reconciliation and delivery work
open and no recorded supersession. Newer device login deliveries alone do not
prove this plan's KHAL session validation and tenant integration have shipped.

## Design

Group 0 must first reconcile middleware placement, principal projection, role
naming and execution order with RFC-0006. No middleware implementation starts
before that reconciliation is reviewed SHIP. The plan does not create a second
platform-authority path or a separate tenant-mode flag.

The CLI obtains a device grant from the platform, polls at the returned interval
and consumes its exchange URL. Same-origin UI uses an httpOnly session cookie;
cross-origin UI uses a short-lived Bearer session. API keys remain a recovery
and automation path. Until tenant enforcement is live, lower-role sessions fail closed.

The original `apps/ui` target has been removed. Delivering the UI requires the
plan's behavior on the current product surface, not restoration of that old app.

## Contracts introduced

- Reuse `OMNI_MULTITENANCY_ENABLED` and its enforcement posture; no new mode flag.
- Validate the `khal-session` cookie or Bearer JWT with pinned HS256, temporal
  claims and Zod-validated `userId`, `orgId`, role and permissions.
- The planned Bearer discriminator routes three-segment JWTs to session validation;
  ordinary API keys retain their path. Group 0 settles chain position and projection.
- Discovery exposes `{ multitenant, platformUrl }` before login as the plan's
  explicit disclosure contract. It does not expose tenant inventory.
- `omni auth login` targets the selected server entry; polling honors issuer
  intervals and `exchange_url`. One silent exchange on 401 precedes a named re-login.
- Existing named-server storage gains short-lived session state; single-tenant
  credentials and local-runtime isolation retain their established behavior.

## Threat model

The platform authenticates humans; Omni validates sessions and maps authority
through its real tenancy boundary. KHAL role names cannot silently confer Omni's
platform credential class. Admin-grade access remains the temporary maximum
until the existing tenant enforcement gate permits other roles. Logout removes
local session state; expiry and server authorization still govern copied tokens.
Security-gap titles only: “Session authority reconciliation” and “Tenant enforcement sequencing”.

## Deliveries

No dedicated issue/PR mapping is present; file each group separately when admitted.

1. Group 0: architecture reconciliation and sequencing agreement.
   Acceptance: written chain/projection/role/discriminator decisions receive SHIP.
   Rollback: revise the design; no runtime mutation precedes that gate.
2. Group 1: API session validation and discovery.
   Acceptance: valid admin sessions authenticate; invalid/expired sessions and
   disallowed roles fail closed while API keys still work.
   Rollback: disable the session integration and retain API-key authentication.
3. Group 2: CLI device login and bounded 401 recovery.
   Acceptance: approval completes on the selected server and no credential leaks
   to a local service. Rollback: clear that entry's session and use its API key.
4. Group 3: mode-aware product login, roles and logout.
   Acceptance: the owner completes login and logout on the current UI surface.
   Rollback: restore the previous login surface; issued sessions expire/revoke
   through their authority, not through a UI code revert.

## Progress

The supplied merged-PR snapshot contains no delivery identified for this KHAL
session plan. #1310 and #1324/#1334 delivered newer human/device login work;
they are adjacent work, not proof of the platform validator and sequencing gate.
The WISH preserves the split from the earlier named-server plan and the Group 0
blockers. No implementation or owner acceptance is claimed here.

## Open questions

The plan explicitly leaves chain position/principal projection, KHAL role mapping
and sequencing with tenant enforcement for Group 0. Recommendation: resolve them
together against RFC-0006, retain its isolated authority boundary, and review SHIP
before starting API work. The plan's Bearer shape discriminator is the proposed
answer for routing credentials; precedence and refusal behavior need that review.

## Links

- [RFC-0006](0006-full-multitenancy.md)
- [Original named-server plan](../../.genie/wishes/multi-server-management/WISH.md) — completed client foundation
- [#1310](https://github.com/automagik-dev/omni/pull/1310) — separate human-login delivery
