# Omni's plugin lane

Omni's DSH plugins, the channels (`@automagik/omni-channels-dsh`) and the canvases
(`@automagik/omni-canvas-dsh`), reach the Automagik desktop app on a route of their own. A
new Omni release updates them in the app without a new app.

The lane is the same schemaVersion 1 lane that Automagik and Genie publish. Its format is in
automagik-dev/automagik `plugin-lane/README.md`. Omni's lane is at:

- https://github.com/automagik-dev/omni/releases/download/plugin-lane/lane.json
- https://github.com/automagik-dev/omni/releases/download/plugin-lane/lane.json.sig

`keys.json` lists the public keys, as `{ keys: [{ keyId, publicKey }] }` with PEM (SPKI).
Consumers pin them in their code. The signature is ed25519 over the exact bytes of
`lane.json`, detached, base64.

## What Omni's lane says

- `publisher` is `omni`, and `keyId` is `omni-2026-10`.
- `version` and `commit` are the stable Omni release that issued the lane.
- `sequence` is that release's place in order: 2.YYMMDD.N as YYMMDD·10000 + N.
- `base` is `3.0.0`, the oldest app the plugins run on, as with Genie's lane. It is not an
  app release line. Each plugin's `engines.dsh` decides whether it runs.
- Each plugin is listed at its own version: the Omni release of its last change.

## Where the tarballs are

The rolling `plugin-lane` release keeps every plugin tarball the lane has named, one per
plugin version, and never replaces one. A plugin whose version the lane already carries is
listed with the kept tarball, not a new pack, so a version's bytes never change. Omni's
versioned releases (`v2.*`) keep exactly their signed binaries.

## Publishing

`release.yml` runs the `plugin-lane` job after every stable publish, using
`scripts/plugin-lane.ts`:

1. `pack` packs the plugins.
2. `manifest` writes the lane.
3. `sign` signs it.
4. `verify` checks it.

The signing key is the `PLUGIN_LANE_KEY` Actions secret. It exists only there.
