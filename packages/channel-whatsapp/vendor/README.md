# Vendored Baileys build

`baileys-v7.0.0-rc10.tgz` is built from the upstream `v7.0.0-rc10` source and kept at the same package version so the local-file dependency remains reproducible.

Omni carries three focused changes in this artifact:

- support for WhatsApp's passkey companion-pairing ceremony (`passkey_prologue_request` / `crsc_continuation`);
- removal of WebSocket events that Bun does not implement;
- transient pre-key failures use the existing retry path without error-level log noise.

The passkey implementation validates the WhatsApp relying party, never logs the WebAuthn assertion or derived keys, and exposes the ceremony through typed socket methods and `connection.update` states.

SHA-256: `59616b5f71af6d225fc2de4fc5add657f5b82647830333f3b490e2f3b26ff35a`
