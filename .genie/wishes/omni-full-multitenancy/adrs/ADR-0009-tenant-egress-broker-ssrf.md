<!-- adr_topic: tenant_egress_broker_ssrf -->
# ADR-0009 — Tenant-egress broker and SSRF boundary

- Status: proposed (G0 gate)

## Context
Tenant-controlled outbound egress is unbounded today. The automation webhook action does a
raw `fetch` on a tenant-templated URL with no SSRF guard
(packages/core/src/automations/actions.ts:132,141). Provider clients fetch tenant `baseUrl`
(webhook-provider/a2a-client/ag-ui-client/agno-client). Only media has a partial guard
(packages/api/src/utils/safe-media-fetch.ts), and it exposes an `OMNI_MEDIA_URL_GUARD=off`
escape hatch. Database isolation does not make arbitrary outbound fetches safe.

## Decision
- All tenant-controlled egress (automations, webhook providers, callbacks, provider `baseUrl`, any future URL-capable integration) goes through ONE audited egress broker. Direct `fetch`/socket use from tenant routes, providers, plugins, automations, and workers is blocked by architecture checks and runtime network policy.
- Destination policy is default-deny: only explicitly approved HTTPS destinations or approved platform connector classes; policies are tenant-bound and cannot grant access to platform/control-plane networks.
- The broker rejects loopback, RFC1918, CGNAT, link-local, multicast, Unix sockets, cloud metadata, cluster/service networks, auth/control-plane endpoints, and non-approved schemes/ports.
- DNS is resolved and validated immediately before connection; every redirect hop is re-resolved and revalidated; DNS rebinding, alternate IP encodings, IPv4-mapped IPv6, credential-bearing URLs, and userinfo confusion are rejected.
- Bounded connect/read timeouts, redirect count, request/response body size, and concurrency. Ambient platform credentials, cookies, proxy credentials, and cloud identity headers are never attached.
- Egress decisions record tenant, actor, integration, normalized destination class, policy version, and outcome without logging secrets.
- The media `OMNI_MEDIA_URL_GUARD=off` escape hatch is removed / subsumed by the broker for tenant contexts.

## Consequences
- G5 delivers the broker and network bypass prevention; G7 runs the SSRF/rebinding matrix.

## Preserves
WISH "Tenant-controlled outbound egress"; Success Criterion 20; QA tenant-egress tests.
