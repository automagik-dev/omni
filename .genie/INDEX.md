# Plans Index

## Raw
- signed-webhook-source-migration — split out of gitlab-sdlc-connector (owner, 2026-11-01): move signed webhook sources (GitHub, ClickUp) into per-provider connectors; open issues: GitHub action-bearing types, dependant rewrite, dead-letter retries (see that DESIGN.md review findings)

## Simmering

- live-update-and-releases — superseded 2026-10-24 by automagik-dev-flow (owner: Omni's process stays unchanged; the new process is Automagik's). Kept locally as research. Stopped at round 10, WRS 93.
- automagik-dev-flow — moved 2026-10-24 to the Automagik repository (Automagik owns it; see its .genie/INDEX.md).

## Ready
- paired-agents — paired agents receive only the events they own (C0-C20); DESIGN.md SHIP (review 5, 2026-11-02), WRS 100, size G; fixes 1-3 merged (#1459, #1460, #1462/#1469); follow-up A (fail-open repair, PR #1475) and follow-up B (route-named agents keep keys) pending; next route wish
- gitlab-sdlc-connector — GitLab lifecycle events to the agent team; DESIGN.md SHIP (review 4, 2026-11-01), WRS 100, size G: slice 1 ingress, slice 2 GitLab, slice 4 measurement; next route: wish

## Poured

- [slack-personal-oauth](wishes/slack-personal-oauth/WISH.md) — one-click native Slack OAuth for personal (user-mode) instances: per-deployment app, shared Socket Mode receiver, auto-provisioned instances. Design SHIP, plan APPROVED 2026-09-21; 8 groups over 5 waves.

- [omni-plugin-revamp](wishes/omni-plugin-revamp/WISH.md) — simplify plugins/omni to genie-plugin conventions; kill stale v4 surface. Design SHIP, plan SHIP, status APPROVED; 4 groups on the board.
