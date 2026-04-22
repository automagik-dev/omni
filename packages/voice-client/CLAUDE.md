# @omni/voice-client

Bun-native voice client implementing Discord Voice Gateway v8 with mandatory DAVE E2EE.

## Architecture

```
DiscordVoiceSession (session.ts)     — orchestrates all layers
  ├── VoiceGateway (gateway.ts)      — WebSocket to Discord Voice Gateway v8
  ├── VoiceUdp (udp.ts)             — UDP socket, IP Discovery, raw packet I/O
  ├── SrtpDecryptor (crypto/srtp.ts) — SRTP encrypt/decrypt (libsodium)
  ├── DaveManager (crypto/dave.ts)   — DAVE E2EE via @snazzah/davey (MLS)
  └── PacketReceiver (receiver.ts)   — SSRC→userId demux, per-user AudioStream
```

## Connection Flow

1. **Gateway WebSocket** opens to `wss://{endpoint}?v=8`
2. **Identify** with `max_dave_protocol_version` → server responds with **Ready** (SSRC, UDP IP/port, modes)
3. **UDP socket** created, **IP Discovery** performed
4. **Select Protocol** sent with preferred encryption mode
5. **Session Description** received → SRTP secret key, DAVE protocol version
6. **DAVE init** → send MLS key package (Op 26)
7. **DAVE handshake** via binary opcodes 25-31 (external sender, proposals, commit, welcome)
8. **Audio flows**: UDP packets → SRTP decrypt → DAVE decrypt → Opus frames → PacketReceiver

## DAVE Protocol (Discord Audio Video Encryption)

Mandatory since March 2026. Uses MLS (Messaging Layer Security) via `@snazzah/davey`.

| Opcode | Name | Direction | Format |
|--------|------|-----------|--------|
| 21 | DavePrepareTransition | S→C | JSON: `{transition_id, protocol_version}` |
| 22 | DaveExecuteTransition | S→C | JSON: `{transition_id}` |
| 23 | DaveTransitionReady | C→S | JSON: `{transition_id}` |
| 24 | DavePrepareEpoch | S→C | JSON: `{protocol_version, epoch}` |
| 25 | DaveMlsExternalSender | S→C | Binary: MLS external sender package |
| 26 | DaveMlsKeyPackage | C→S | Binary: client's MLS key package |
| 27 | DaveMlsProposals | S→C | Binary: `[optype:u8][proposals:rest]` |
| 28 | DaveMlsCommitWelcome | C→S | Binary: commit+welcome response |
| 29 | DaveMlsAnnounceCommitTransition | S→C | Binary: `[transitionId:u16 BE][commit:rest]` |
| 30 | DaveMlsWelcome | S→C | Binary: `[transitionId:u16 BE][welcome:rest]` |
| 31 | DaveMlsInvalidCommitWelcome | C→S | JSON: `{transition_id}` — triggers reinit |

**Downgrade**: `protocol_version=0` in Op 21 → passthrough mode (no E2EE).

## Encryption Modes (SRTP)

Preference order (best first):

1. `aead_xchacha20_poly1305_rtpsize` — current Discord default, 24-byte nonce
2. `aead_aes256_gcm_rtpsize` — 12-byte nonce, requires hardware AES (not always available in libsodium)
3. `xsalsa20_poly1305_lite` — legacy, 24-byte nonce, no AAD

**Nonce format**: Last 4 bytes of encrypted payload are an incrementing counter, zero-padded to mode's nonce size.

**libsodium note**: AES-256-GCM availability depends on CPU and libsodium build. The code checks at runtime (`sodiumAny.crypto_aead_aes256gcm_decrypt`) and throws early if unavailable.

## Send Path

Opus frame → DAVE encrypt (`encryptOpus`) → RTP header → SRTP encrypt (`encryptRaw`) → UDP send

## Interfaces

- **VoiceTransport** (`interfaces/transport.ts`): platform-agnostic voice transport
- **EncryptionLayer** (`interfaces/encryption.ts`): generic encrypt/decrypt
- **AudioStream** (`stream/audio-stream.ts`): per-user ReadableStream of Opus frames

## Testing

```bash
bun test packages/voice-client/
```

Tests mock `@snazzah/davey` via `bun:test` `mock.module()` for DaveManager tests. SRTP tests use real libsodium.
