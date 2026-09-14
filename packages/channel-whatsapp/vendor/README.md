# Vendored Baileys build

`baileys-v7.0.0-rc14.tgz` is built from the upstream `7.0.0-rc14` npm release and kept at the same package version so the local-file dependency remains reproducible.

Omni carries three focused changes in this artifact:

- support for WhatsApp's passkey companion-pairing ceremony (`passkey_prologue_request` / `crsc_continuation`);
- removal of WebSocket events that Bun does not implement;
- transient pre-key failures use the existing retry path without error-level log noise.

The passkey implementation validates the WhatsApp relying party, never logs the WebAuthn assertion or derived keys, and exposes the ceremony through typed socket methods and `connection.update` states.

SHA-256: `291a325040e72c626936702ab0fb65df1e3575e654070d5c429ec949a9fcb3c1`

## Refreshing the vendored copy

A pinned tarball has no update signal, so check `npm view baileys dist-tags` when touching the channel (rc10 drifted four RCs silently).

1. Download the stock releases for the current and the target version from the npm registry and verify the target against `dist.integrity` (`curl -sO https://registry.npmjs.org/baileys/-/baileys-<ver>.tgz`, then compare `sha512-$(openssl dgst -sha512 -binary <tgz> | base64 -w0)`).
2. Extract the Omni patch set: `diff -ruN -x '*.map' <stock-current>/package <vendored-current>/package > omni.patch`.
3. Apply it to the target (`patch -p2` inside the extracted `package/`) and hand-resolve any rejects; then repack as `baileys-v<ver>.tgz` with a top-level `package/` directory.
4. Point `package.json` at the new file, run `bun install`, `make test-file F=packages/channel-whatsapp` and `make check`, and update the SHA-256 above.
