# Brainstorm: Omni Agentic CLI — Multimodal Verbs + Conversation Context

| Field | Value |
|-------|-------|
| **Slug** | `omni-agentic-cli` |
| **Date** | 2026-04-05 |
| **Issue** | #259 |
| **WRS** | 100/100 |

## Problem
Omni's CLI requires explicit instance IDs, JIDs, and flags for every interaction — the opposite of how humans use messaging apps. Multimodal capabilities (image gen, TTS, STT, vision, video gen) live in scattered Python scripts that shell out to `omni send`. The platform needs native verb commands with IM-like conversation context, backed by multi-provider media services where every capability is provider-agnostic with configurable defaults and per-call overrides.

## Scope
### IN
1. **Conversation context** — `omni open/use/where/close`, backed by PG (per API key), env var override for agents
2. **8 agentic verb commands** — `say`, `send`, `speak`, `react`, `imagine`, `film`, `listen`, `see`
3. **`--reply` modifier** — universal quote-reply on any verb (no separate reply command)
4. **Provider-agnostic media** — TTS, STT, image gen, video gen, vision all go through provider interfaces with configurable defaults + `--provider` override
5. **Gemini providers** — image gen (Nano Banana 2), TTS, STT, video gen (Veo 3.1), vision
6. **Existing provider integration** — ElevenLabs TTS + Groq Whisper STT as first-class providers alongside Gemini
7. **Instance scoping enforcement** — `api_keys.instanceIds` exists in schema, enforce server-side
8. **Auto-provisioned agent keys** — assigning agent to instance auto-creates scoped API key
9. **Persons CLI** — `omni persons merge/link/update` commands (API exists, CLI doesn't)
10. **Smarter auto-linking** — when @lid resolves to known phone, link identity to existing person instead of creating new one
11. **Full coexistence** — `omni send --text --instance --to` unchanged, verb commands are a layer on top

### OUT
- Replacing ElevenLabs or Groq — they remain as providers
- Music generation (Lyria)
- Live/streaming modes
- Multi-turn image editing (Gemini 3 thought signatures)
- Non-Gemini image/video gen providers (DALL-E, etc.)
- Person deduplication UI/bulk tools (separate wish)
- Breaking changes to existing CLI commands

## Models
| Capability | Model | Notes |
|-----------|-------|-------|
| Image gen (default) | `gemini-3.1-flash-image-preview` | Nano Banana 2, via generateContent |
| Image gen (pro) | `gemini-3-pro-image-preview` | Nano Banana Pro, thinking-enhanced |
| Image gen (fast) | `gemini-2.5-flash-image` | Nano Banana, speed-optimized |
| TTS (Gemini) | `gemini-2.5-flash-preview-tts` | 30 voices, multi-speaker |
| STT (Gemini) | `gemini-3-flash-preview` | Audio understanding, timestamps |
| Video gen | `veo-3.1-generate-preview` | Native audio, 720p-4K |
| Vision | `gemini-3.1-flash-lite-preview` | Default multimodal model |

---

## Architecture

### Provider Model — Every Verb is Provider-Agnostic

```
CLI verb (say, speak, listen, imagine, etc.)
  → resolves context (flags → env → PG → config)
  → calls API endpoint
    → provider router (reads default from config, accepts --provider override)
      → GeminiProvider / ElevenLabsProvider / GroqProvider / etc.
```

```bash
# Defaults set via config
omni config set tts.provider gemini         # default TTS
omni config set stt.provider groq           # default STT
omni config set imagegen.provider gemini    # default image gen
omni config set videogen.provider gemini    # default video gen
omni config set vision.provider gemini      # default vision

# Verbs use default, --provider overrides
omni speak "hello"                          # → default TTS provider
omni speak "hello" --provider elevenlabs    # → ElevenLabs
omni speak "hello" --provider gemini        # → Gemini

omni listen audio.ogg                       # → default STT provider
omni listen audio.ogg --provider gemini     # → Gemini
omni listen audio.ogg --provider groq       # → Groq Whisper
```

Provider interfaces:
```typescript
interface ITtsProvider {
  generate(text: string, options: TtsOptions): Promise<AudioBuffer>;
  listVoices(): Promise<Voice[]>;
}

interface ISttProvider {
  transcribe(audio: Buffer, options: SttOptions): Promise<TranscriptResult>;
}

interface IImageGenProvider {
  generate(prompt: string, options: ImageGenOptions): Promise<ImageResult>;
}

interface IVideoGenProvider {
  generate(prompt: string, options: VideoGenOptions): Promise<VideoResult>;
}

interface IVisionProvider {
  describe(media: Buffer, options: VisionOptions): Promise<string>;
}
```

---

### Context Layer — PG-backed, Permission-Scoped

**No files.** Context stored in PG on the API key. Env vars override for agents.

#### Commands

| Command | Who uses it | What it does |
|---------|------------|--------------|
| `omni use <instance>` | Admins (multi-instance keys) | Set active instance |
| `omni open <contact>` | Everyone | Open chat within accessible instances |
| `omni where` | Everyone | Show current context |
| `omni close` | Everyone | Clear context |

#### `omni open` — resolution scoped by API key permissions

```bash
omni open felipe                    # search chats on YOUR instances only
omni open nmstx                     # fuzzy match chat name
omni open 5512982298888             # phone number
omni open febc95ba                  # chat ID prefix
```

Resolution flow:
```
1. Get accessible instances from api_keys.instanceIds (null = all)
2. If admin with multiple instances, filter by active instance (from "omni use")
3. Search chats + persons ONLY on accessible instances
4. One match → open
5. Multiple matches → pick most active, show alternatives
6. Zero matches → "contact not found on your instances"
```

**Scoped agents never see disambiguation.** They have one instance. `omni open felipe` finds Felipe on that instance or errors. No `@sofia`, no `@telegram` — their key only sees one world.

**Admins use `omni use` to switch between instances:**
```bash
omni use sofia                      # set active instance
omni open felipe                    # → Felipe on Sofia
omni use telegram                   # switch
omni open felipe                    # → Felipe on Telegram
```

#### Context storage — PG on api_keys

```sql
ALTER TABLE api_keys ADD COLUMN active_instance_id UUID REFERENCES instances(id);  -- "omni use"
ALTER TABLE api_keys ADD COLUMN context_instance_id UUID REFERENCES instances(id);  -- "omni open" resolved instance
ALTER TABLE api_keys ADD COLUMN context_chat_id TEXT;
ALTER TABLE api_keys ADD COLUMN context_message_id TEXT;
ALTER TABLE api_keys ADD COLUMN context_updated_at TIMESTAMP;
```

#### Resolution chain (first match wins):
```
1. --to / --instance flags         ← explicit, always wins
2. OMNI_INSTANCE / OMNI_CHAT env   ← per-process (agent dispatcher)
3. PG context (per API key)        ← persistent ("omni open" state)
4. omni config defaults            ← fallback
5. error                           ← nothing
```

---

### Instance Scoping + Auto-Provisioned Agent Keys

**`api_keys.instanceIds UUID[]` already exists.** Enforce it server-side: middleware validates `instanceId ∈ key.instanceIds` on every request.

**Auto-provisioning:** When an agent is assigned to an instance, auto-create/update a scoped key:

```bash
omni instances update sofia --agent my-agent
# → Auto-creates API key "agent:my-agent" scoped to [sofia]
# → Key stored on agent record
```

Agent assigned to second instance → key updated: `instanceIds = [sofia, claudia]`.
Agent removed from instance → key updated to remove that instance.

Dispatcher uses the agent's auto-provisioned key:
```typescript
// agent-dispatcher.ts
const agentKey = agent.apiKey;  // auto-provisioned, scoped
process.env.OMNI_API_KEY = agentKey;
process.env.OMNI_INSTANCE = instance.id;
process.env.OMNI_CHAT = payload.chatId;
process.env.OMNI_MESSAGE = payload.messageId;
```

---

### Verb Commands

#### Communication (send to open chat)

```bash
# say — text message
omni say "oi, tudo bem?"
omni say "concordo" --reply                  # quote-reply to trigger/last msg
omni say "concordo" --reply abc123           # quote-reply to specific msg

# send — deliver file/media (auto-detects type from extension)
omni send foto.jpg                           # image
omni send recording.ogg                      # audio
omni send video.mp4                          # video
omni send contract.pdf                       # document
omni send foto.jpg --caption "olha isso"     # with caption
omni send foto.jpg --reply                   # file as quote-reply

# speak — voice note via TTS (provider-agnostic)
omni speak "bom dia"                         # default provider
omni speak "escuta isso" --voice Kore        # specific voice
omni speak "hello" --provider elevenlabs     # override provider
omni speak "calma" --style "slow and calm"   # Gemini style prompt

# react — emoji reaction
omni react 👍                                # react to last/trigger message
omni react ❤️ --msg abc123                   # react to specific message
```

#### Generative (create content → send to chat)

```bash
# imagine — generate image (provider-agnostic)
omni imagine "a cat wearing sunglasses"
omni imagine "pricing table" --aspect-ratio 16:9 --size 2048
omni imagine "logo" --model nano-banana-pro
omni imagine "cat" --output cat.png          # save locally, don't send
omni imagine "cat" --reply abc123            # generate + quote-reply
omni imagine "cats" --count 3                # 3 variations

# film — generate video (provider-agnostic)
omni film "sunset over sao paulo" --duration 8 --resolution 1080p
omni film "product demo" --reference product.jpg
omni film "continue" --extend clip.mp4
omni film "sunset" --output sunset.mp4
```

Behavior:
- With context → generates + sends to chat
- With `--output` → saves locally, does NOT send
- With `--reply` → generates + sends as quote-reply
- No context + no output → saves to temp file, prints path

#### Understanding (process content → stdout by default)

```bash
# listen — transcribe audio (provider-agnostic)
omni listen voice.ogg                        # → stdout (agent uses internally)
omni listen voice.ogg --reply                # transcribe + quote-reply with text
omni listen voice.ogg --provider gemini      # force Gemini
omni listen voice.ogg --provider groq        # force Groq
omni listen voice.ogg --timestamps           # word-level timestamps (Gemini)
omni listen voice.ogg --format srt           # SRT subtitles

# see — describe image/video (provider-agnostic)
omni see photo.jpg                           # → stdout
omni see photo.jpg --reply                   # describe + quote-reply
omni see screenshot.png "what app is this?"  # guided prompt
omni see video.mp4                           # video understanding
```

---

### `--reply` — Universal Quote Modifier

One mechanism. No separate `reply` verb. Composes with all 8 verbs.

```bash
omni say "text" --reply                      # text quote-reply
omni send file.pdf --reply                   # file quote-reply
omni speak "text" --reply abc123             # voice quote-reply to specific msg
omni imagine "cat" --reply                   # generate + quote-reply
omni listen audio.ogg --reply                # transcribe + quote-reply with result
```

Resolution for which message to quote:
1. `--reply <msg-id>` — explicit message ID (always wins)
2. `OMNI_MESSAGE` env var — set by dispatcher (trigger message)
3. Last received message in open chat
4. Error if none available

---

### Persons CLI — Expose Existing APIs

```bash
omni persons merge <source-id> <target-id> [--reason "duplicate"]
omni persons link <identity-a-id> <identity-b-id>
omni persons unlink <identity-id> --reason "wrong link"
omni persons update <id> --phone "+5512982298888" --email "felipe@x.com"
```

### Smarter Auto-Linking

In `PersonService.findOrCreateIdentity()`: when a platform identity arrives with a platformUserId that maps to a known phone (via `chat_id_mappings` @lid → @s.whatsapp.net), check if a person with that phone already exists and link to them instead of creating a new person.

---

### Shared Flags

```bash
# Universal (all verbs)
--instance <id>         # override instance (bypass context)
--to <recipient>        # override chat (bypass context)
--reply [msg-id]        # send as quote-reply
--msg <msg-id>          # specify message (for react)
--provider <name>       # provider override
--model <name>          # model override
--output <path>         # save to file (generative verbs)

# Per-verb
--caption <text>        # send: caption for media
--voice <name>          # speak: voice selection
--style <s>             # speak: style prompt (Gemini)
--aspect-ratio <r>      # imagine/film: 1:1, 16:9, 9:16, 4:3, 3:4
--size <s>              # imagine: 512, 1024, 2048, 4096
--count <n>             # imagine: number of images (1-4)
--duration <s>          # film: 5-8s
--resolution <r>        # film: 720p, 1080p, 4K
--reference <path>      # film: reference image
--extend <video>        # film: extend existing video
--language <lang>       # listen: language hint
--timestamps            # listen: word-level timestamps (Gemini)
--format <f>            # listen: text, json, srt
```

---

### Coexistence

Old commands unchanged. New verbs are a convenience layer on top.

```bash
# Old (explicit, scripting, always works):
omni send --instance 4d1054ba --to 5512982298888@s.whatsapp.net --text "oi"

# New (context-aware, IM feel):
omni open felipe
omni say "oi"

# SDK (programmatic):
client.messages.send({ instanceId, to, text: "oi" })
```

All three hit the same API endpoints. Zero breaking changes.

---

## Decisions
| Decision | Rationale |
|----------|-----------|
| 8 verbs, no `reply` verb, `--reply` is a flag | Zero redundancy. One mechanism for quoting. Composes with all verbs. |
| Context in PG, not files | Already have PG. No race conditions, survives machine changes, permission-aware. |
| `omni use` for instance selection (admin only) | Scoped agents never need it — their key only sees one instance. Admins juggle multiple. |
| Provider-agnostic verbs with config defaults | `speak` doesn't know about ElevenLabs. Provider is a config/flag choice. Future providers plug in without changing verbs. |
| Auto-provisioned agent keys on instance assignment | Removes manual key management. Assignment = scoping. |
| Env vars override PG context | Agents get per-process isolation from dispatcher. Humans get persistent context from `omni open`. Both work. |
| Persons CLI exposes existing merge/link/update APIs | API has it, CLI doesn't. Needed for `omni open` to work when persons are fragmented. |
| Smarter @lid auto-linking | Prevents person fragmentation at source. `chat_id_mappings` already has the data. |
| Full coexistence with `omni send` | Zero breaking changes. Old commands are the low-level API. New verbs are the IM layer. |

## Risks & Assumptions
| Risk | Severity | Mitigation |
|------|----------|------------|
| Gemini preview models change API surface | Medium | Pin model versions, abstract behind provider interface |
| Video gen is async + expensive | Medium | Rate limiting, progress bar, timeout with cleanup |
| Image gen returns base64 inline — large payloads | Low | Stream to disk, don't buffer in memory |
| Person fragmentation makes `omni open` ambiguous | Medium | Persons merge CLI + smarter auto-linking fix root cause |
| Instance scoping enforcement may break existing integrations | Medium | Audit current key usage, add grace period, null instanceIds = all (backwards compat) |
| Context on api_keys adds load to auth path | Low | One SELECT on PK, negligible |
| Many commands to implement — scope creep risk | High | Provider interfaces first, then verbs one at a time. Each verb is independently shippable. |
| `@google/genai` SDK maturity for TypeScript | Low | Python tools already validate the API works. TS SDK is official. |

## Success Criteria
- [ ] `omni open <contact> && omni say "test"` delivers a text message to the correct chat
- [ ] `omni use <instance>` sets active instance for admin keys, persisted in PG
- [ ] `omni where` shows current instance + chat + channel
- [ ] `omni say "text" --reply` sends a quote-reply to the trigger message
- [ ] `omni send file.jpg` delivers media to the open chat
- [ ] `omni speak "hello"` generates voice note via default TTS provider and sends
- [ ] `omni speak "hello" --provider elevenlabs` uses ElevenLabs regardless of default
- [ ] `omni speak "hello" --provider gemini` uses Gemini TTS regardless of default
- [ ] `omni react 👍` reacts to the last message in the open chat
- [ ] `omni imagine "a cat"` generates an image via Nano Banana 2 and sends to chat
- [ ] `omni imagine "a cat" --output cat.png` saves locally without sending
- [ ] `omni film "sunset"` generates a video via Veo 3.1 and sends to chat
- [ ] `omni listen audio.ogg` returns transcription to stdout (default STT provider)
- [ ] `omni listen audio.ogg --reply` transcribes + sends as quote-reply
- [ ] `omni listen audio.ogg --provider gemini` uses Gemini STT
- [ ] `omni see photo.jpg` returns description to stdout
- [ ] `omni see photo.jpg --reply` describes + sends as quote-reply
- [ ] Scoped API key gets 403 when accessing unauthorized instance
- [ ] Assigning agent to instance auto-provisions scoped API key
- [ ] `omni persons merge <a> <b>` merges two persons via existing API
- [ ] `omni persons update <id> --phone "+55..."` updates person fields
- [ ] `omni config set tts.provider gemini` sets default, subsequent `omni speak` uses Gemini
- [ ] `omni send --text "hi" --instance X --to Y` still works unchanged (coexistence)
- [ ] All existing tests pass: `bun test`
- [ ] TypeScript compiles: `bunx tsc --noEmit`

---

## Data Model (real, from codebase exploration)

### Existing entities:
- **persons** — displayName, primaryPhone, primaryEmail (6 "Felipe Rosa" records due to @lid fragmentation)
- **platform_identities** — personId, channel, instanceId, platformUserId, linkedBy, confidence
- **chats** — instanceId, externalId, canonicalId, chatType, name
- **chat_participants** — chatId, personId, platformIdentityId, displayName, role
- **api_keys** — instanceIds[], scopes[], rateLimit (instance scoping exists but not enforced)
- **chat_id_mappings** — instanceId, lidId, phoneId (WhatsApp @lid → @s.whatsapp.net resolution)
- **messages** — for --reply resolution (replyToMessageId, replyToExternalId)

### New fields:
```sql
-- Context + active instance on api_keys
ALTER TABLE api_keys ADD COLUMN active_instance_id UUID REFERENCES instances(id);
ALTER TABLE api_keys ADD COLUMN context_instance_id UUID REFERENCES instances(id);
ALTER TABLE api_keys ADD COLUMN context_chat_id TEXT;
ALTER TABLE api_keys ADD COLUMN context_message_id TEXT;
ALTER TABLE api_keys ADD COLUMN context_updated_at TIMESTAMP;
```

### Provider config:
```sql
-- Provider defaults (could go in settings or a new provider_config table)
-- Or simpler: key-value in existing omni config system
-- tts.provider = gemini | elevenlabs
-- stt.provider = gemini | groq
-- imagegen.provider = gemini
-- videogen.provider = gemini
-- vision.provider = gemini
```

---

## WRS
```
WRS: ████████████████████ 100/100
 Problem ✅ | Scope ✅ | Decisions ✅ | Risks ✅ | Criteria ✅
```
