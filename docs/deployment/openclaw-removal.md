# Release note: OpenClaw removal

This release removes the OpenClaw gateway provider/client, device pairing and setup
CLI, and the `@omni/plugin-openclaw` integration package. Use a supported provider
(Agno, webhook, AG-UI, Claude Code, A2A, or NATS Genie) instead.

This is a **breaking SDK change**: `openclaw` is no longer accepted in provider
create/update request types or API validation. Existing provider response types
retain it only as a legacy read marker so operators can inspect and replace or
delete old providers. The setup CLI and provider implementation are gone.

## Stored providers and credentials

Existing rows and secrets are retained. There is no migration, backfill, automatic
disable, credential deletion, or row deletion. Reading an old row does not throw
or prevent Omni from starting. List/detail responses mark the provider unhealthy
and show a clear error:

> OpenClaw provider removed in <running Omni version>; delete or replace this provider

Dispatch, manual agent runs, and provider health probes refuse that provider with
the same versioned error. They make no outbound connection and never fall back to
another provider implementation. Replace the provider schema/configuration using
normal management APIs, or delete the provider when it is no longer referenced.
Legacy credential sealing and API masking remain in place until operators remove
the retained secrets themselves.

The channel SDK's shared deduplication and thread caches, Slack's HTTP body limit,
and Discord's thread behavior remain available to other channels. The two channel
implementation research documents are preserved.

## npm package status

The public npm registry returns HTTP 404 (`Not found`) for
`@omni/plugin-openclaw`; there is no currently published version. Repository
publication workflows publish the CLI and SDK, not this plugin. No evidence of
an earlier publication was found; a registry 404 cannot exclude a historical
publication that was later unpublished. This change does not unpublish or
deprecate anything on npm. Either action remains a separate owner decision.
