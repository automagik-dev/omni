# Wish: Media Handling Parity

**Status:** READY  
**Slug:** parity-media  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** M  

---

## Problem

Three media gaps exist between the channels:

1. **Telegram sticker send is declared but not wired.** `canSendSticker: true` in capabilities, sticker *receive* works, but `dispatchMedia()` in `plugin.ts` has no `'sticker'` case — it falls through to a text fallback. grammy has `bot.api.sendSticker()` ready to use.

2. **Telegram has no media download to disk.** WhatsApp downloads all received media to `data/media/{instance}/{YYYY-MM}/` via `tryDownloadMedia()`. Telegram just passes the `file_id` as `mediaUrl` — the actual file lives on Telegram's servers and is only accessible via the Bot API's `getFile` endpoint. This means: media is ephemeral (Telegram files expire), media can't be processed locally (no transcription, no OCR, no forwarding to other channels), and there's no consistent media storage across channels.

3. **Voice note (PTT) handling.** WhatsApp has full PTT support with OGG/OPUS conversion via ffmpeg. Telegram treats voice messages as regular audio — which is fine (no gap per se), but the media type metadata should be normalized so consumers know when audio is a voice note vs. a file.

## Audit Evidence

- **Telegram sticker send:** `canSendSticker: true` declared, no `'sticker'` case in `dispatchMedia()`. grammy supports `bot.api.sendSticker()`. **Gap: not-yet-implemented.**
- **Telegram media download:** Passes `file_id` as `mediaUrl`. No local download. grammy supports `bot.api.getFile()` + HTTP download. **Gap: not-yet-implemented.**
- **WhatsApp media download:** `tryDownloadMedia()` in `handlers/messages.ts` — downloads to `data/media/{instance}/{YYYY-MM}/`. Fully implemented.
- **WhatsApp PTT:** `ptt: true` in audio builder, `processAudioForVoiceNote()` converts to OGG/OPUS via ffmpeg.
- **WhatsApp sticker send:** Fully implemented — `buildStickerContent()` in `senders/media.ts`.

## Scope

### IN

- [ ] Add `'sticker'` case to Telegram `dispatchMedia()` → `bot.api.sendSticker()` (supports file_id, URL, and Buffer)
- [ ] Implement Telegram media download to disk: `bot.api.getFile()` → download via HTTPS → save to `data/media/{instance}/{YYYY-MM}/`
- [ ] Store local file path in event payload alongside the Telegram `file_id` (both useful)
- [ ] Match WhatsApp's directory structure for consistency: `data/media/{instance}/{YYYY-MM}/{filename}`
- [ ] Normalize voice note metadata: add `isVoiceNote: boolean` to the canonical media event so consumers can distinguish PTT from file audio
- [ ] Handle download failures gracefully (Telegram files can expire after ~1 hour for bots without local API)

### OUT

- Media transcoding between channels (e.g., converting WhatsApp stickers to Telegram format)
- Media CDN or S3 storage (local disk only for now)
- Telegram voice-to-OGG conversion (Telegram already sends OGG for voice)
- WhatsApp media download improvements (already working well)
- Media forwarding between channels (separate feature)

## Acceptance Criteria

- [ ] Sending a sticker via Telegram API succeeds (visible in Telegram client)
- [ ] Receiving any media on Telegram saves the file to `data/media/{instance}/{YYYY-MM}/`
- [ ] Downloaded Telegram files have correct extensions based on MIME type
- [ ] Media event payload includes both `mediaUrl` (remote) and `localPath` (disk) when available
- [ ] Voice note metadata (`isVoiceNote`) present in canonical media events for both channels
- [ ] Download failure doesn't crash the handler — event still emitted with `file_id` only
- [ ] `canSendSticker` no longer lies — Telegram actually sends stickers

## Library Blockers

- **Telegram file expiration:** Bot API files are only guaranteed available for 1 hour after `getFile()`. Download must happen immediately upon receive. For high-traffic instances, this could create disk pressure — but that's an operational concern, not a blocker.
