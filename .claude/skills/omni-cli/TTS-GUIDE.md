# Omni CLI - TTS Complete Guide

Complete guide to Text-to-Speech (TTS) features in Omni CLI.

---

## Overview

Omni CLI supports ElevenLabs text-to-speech synthesis, allowing you to send voice notes without recording audio. The TTS feature:

- ✅ Converts text to natural-sounding speech
- ✅ Sends as WhatsApp voice notes (PTT format)
- ✅ Supports 24+ voices (premade, professional, custom)
- ✅ Includes multilingual support
- ✅ Auto-transcribes for searchability
- ✅ Shows recording presence indicator

---

## Commands

### `omni tts voices`

List all available TTS voices.

**Usage:**
```bash
# Human-readable table
omni tts voices

# JSON output
omni tts voices --json

# Filter with jq
omni tts voices --json | jq '.[] | select(.category == "professional")'
```

**Output Fields:**
- `voiceId` - Unique voice identifier
- `name` - Voice name and description
- `category` - premade, professional, or generated

**Example Output:**
```
VOICEID               NAME                                    CATEGORY
--------------------  --------------------------------------  ------------
xWdpADtEio43ew1zGxUQ  Matheus Santos - Friendly and Calm      professional
pNInz6obpgDQGcFmaJgB  Adam - Dominant, Firm                   premade
CwhRBWXzGAHq8TQ4Fs17  Roger - Laid-Back, Casual, Resonant     premade
```

---

### `omni send --tts`

Send text-to-speech voice note.

**Basic Usage:**
```bash
omni send --to <recipient> --tts "<text>" --instance <id>
```

**With Voice Override:**
```bash
omni send --to <recipient> --tts "<text>" --voice-id <voice-id> --instance <id>
```

**Parameters:**
- `--tts <text>` - Text to synthesize (required)
- `--voice-id <id>` - Override default voice (optional)
- `--to <recipient>` - Phone number or chat ID (required)
- `--instance <id>` - Instance ID (required if no default set)

**Response:**
```json
{
  "messageId": "3EB0F06D24B9BA80AA0B8A",
  "externalMessageId": "3EB0F06D24B9BA80AA0B8A",
  "status": "sent",
  "instanceId": "e41f26ef-...",
  "to": "<recipient-id>",
  "audioSizeKb": 22.85,      // Audio file size in KB
  "durationMs": 2514,         // Audio duration in milliseconds
  "timestamp": 1770959118964
}
```

---

## Voice Selection Guide

### Voice Categories

1. **Premade** - General-purpose voices from ElevenLabs
   - Good for: Most use cases
   - Examples: Adam, Rachel, George, Laura

2. **Professional** - Premium voices with specific characteristics
   - Good for: Brand consistency, specific tones
   - Examples: Matheus Santos (Friendly), custom voices

3. **Generated** - Custom cloned voices
   - Good for: Personalization, brand voice
   - Requires: Voice samples uploaded to ElevenLabs

### Choosing the Right Voice

**For Customer Service:**
```bash
# Calm, reassuring voice
omni send --to <phone> --tts "Thank you for contacting us." \
  --voice-id EXAVITQu4vr4xnSDxMaL  # Sarah - Mature, Reassuring
```

**For Notifications:**
```bash
# Clear, professional voice
omni send --to <phone> --tts "Your order has shipped." \
  --voice-id Xb7hH8MSUJpSbSDYk0k2  # Alice - Clear, Engaging
```

**For Marketing:**
```bash
# Energetic, friendly voice
omni send --to <phone> --tts "Special offer just for you!" \
  --voice-id TX3LPaxmHKxFdv7VOQHJ  # Liam - Energetic, Social Media
```

**For Storytelling:**
```bash
# Warm, captivating voice
omni send --to <phone> --tts "Once upon a time..." \
  --voice-id JBFqnCBsd6RMkjVDRZzb  # George - Warm Storyteller
```

---

## Best Practices

### 1. Adding Emotion and Expressiveness

**Use Emotion Tags (ElevenLabs v3 voices):**

```bash
# Excited announcement
omni send --to <phone> --tts "[excited] Great news! Your order has shipped!" --instance <id>

# Sympathetic customer service
omni send --to <phone> --tts "[apologetic] We're sorry for the inconvenience. We'll fix this right away." --instance <id>

# Mysterious storytelling
omni send --to <phone> --tts "[mischievously] You'll never guess what happened next..." --instance <id>

# Professional with emotion
omni send --to <phone> --tts "[confident] Your presentation was excellent. [pause] The client is impressed." --instance <id>
```

**Available Emotion Tags:**
- `[excited]`, `[enthusiastic]`
- `[sad]`, `[crying]`, `[emotional]`
- `[angry]`, `[frustrated]`
- `[sarcastic]`, `[ironic]`
- `[mysterious]`, `[mischievously]`
- `[apologetic]`, `[sympathetic]`
- `[confident]`, `[assertive]`
- `[calm]`, `[relaxed]`

**Use Narrative Context:**

```bash
# Better: Add emotional context
omni send --to <phone> --tts "She asked, her voice trembling with sadness, 'Will you come back?'" --instance <id>

# Instead of just:
omni send --to <phone> --tts "Will you come back?" --instance <id>
```

### 2. Text Optimization

**DO:**
- Keep messages under 500 characters for best quality
- Use natural language and punctuation
- Break long content into multiple messages
- Add pauses with ellipses `...` or dashes `—`
- CAPITALIZE words for EMPHASIS
- Use emotion tags for better delivery

**DON'T:**
- Send URLs or code (hard to pronounce)
- Overuse ALL CAPS (reserved for emphasis)
- Include special characters unnecessarily
- Use complex abbreviations

**Good:**
```bash
# Natural with emotion and pacing
omni send --to <phone> --tts "[cheerful] Hello! Your appointment is confirmed for tomorrow at 10 AM. … Please arrive 5 minutes early." --instance <id>

# With emphasis
omni send --to <phone> --tts "This is VERY important — your package will arrive today." --instance <id>
```

**Bad:**
```bash
omni send --to <phone> --tts "APPOINTMENT CONFIRMED!!! Visit: https://example.com/appt?id=abc123&token=xyz" --instance <id>
```

### 3. Pacing and Pauses

**Use Punctuation for Natural Rhythm:**

```bash
# Ellipses for hesitation/weight
omni send --to <phone> --tts "Well … I suppose we could try that approach." --instance <id>

# Dashes for dramatic pause
omni send --to <phone> --tts "The results are in — and they're amazing!" --instance <id>

# Commas for natural breaks
omni send --to <phone> --tts "First, we'll review the data. Then, we'll make a decision." --instance <id>
```

### 4. Emphasis and Intensity

**Capitalize for Vocal Intensity:**

```bash
# Strategic capitalization
omni send --to <phone> --tts "You did an AMAZING job on this project!" --instance <id>

# Multiple emphasized words
omni send --to <phone> --tts "This is ABSOLUTELY CRITICAL for tomorrow's launch." --instance <id>
```

**Example: Sales Message with Emotion**

```bash
omni send --to <phone> --tts "[excited] HUGE news! … You've been selected for our EXCLUSIVE early access program. [pause] This is a LIMITED time offer — don't miss out!" --instance <id>
```

### 5. Normalize Text for Better Pronunciation

**Convert to Spoken Format:**

```bash
# ✅ Good - Expanded
omni send --to <phone> --tts "Doctor Smith will see you at 2:30 PM. The cost is forty-two dollars and fifty cents." --instance <id>

# ❌ Bad - Abbreviated
omni send --to <phone> --tts "Dr. Smith will see you at 2:30PM. Cost: $42.50" --instance <id>

# ✅ Phone numbers
omni send --to <phone> --tts "Call us at 5-5-5, 1-2-3, 4-5-6-7" --instance <id>

# ❌ Phone numbers
omni send --to <phone> --tts "Call 555-123-4567" --instance <id>
```

### 2. Instance Configuration

Set default voice in instance config for consistency:

```bash
# All TTS from this instance will use this voice
omni instances update <id> --tts-voice xWdpADtEio43ew1zGxUQ
```

Then send without specifying voice:
```bash
omni send --to <phone> --tts "Message" --instance <id>
```

### 3. Error Handling

```bash
#!/bin/bash
# Robust TTS sending with fallback

send_tts() {
  local to=$1
  local text=$2
  local instance=$3

  # Try TTS first
  if omni send --to "$to" --tts "$text" --instance "$instance" 2>/dev/null; then
    echo "✓ Voice note sent"
  else
    echo "⚠ TTS failed, falling back to text"
    omni send --to "$to" --text "$text" --instance "$instance"
  fi
}

send_tts "+5511999" "Hello!" "instance-id"
```

### 4. Rate Limiting

```bash
#!/bin/bash
# Respect rate limits when sending bulk TTS

recipients_file="recipients.txt"
message="Your daily update is ready."

while read -r recipient; do
  omni send --to "$recipient" --tts "$message" --instance <id>
  sleep 3  # 3-second delay between messages
done < "$recipients_file"
```

### 5. Cost Management

TTS consumes ElevenLabs credits. Monitor usage:

```bash
# Count TTS messages sent
omni messages search "" --since 30d --json | \
  jq '[.[] | select(.messageType == "audio" and .transcription != null)] | length'

# Estimate: ~1000 characters = 1 ElevenLabs credit
```

---

## Advanced Use Cases

### Interactive Voice Menus with Emotion

```bash
#!/bin/bash
# Send voice menu with friendly tone

instance_id="<id>"
recipient="<phone>"

# Friendly greeting with pauses
omni send --to "$recipient" --tts "[cheerful] Welcome to our support line! … Press 1 for sales, … 2 for support, … or 3 for billing." --instance "$instance_id"

# Then process incoming messages
omni messages search "" --since 1m --json | \
  jq -r --arg chat "$recipient" '.[] | select(.chatId == $chat and .isFromMe == false) | .textContent'
```

### Emotionally Diverse Customer Service

```bash
#!/bin/bash
# Different emotions for different scenarios

instance_id="<id>"
recipient="<phone>"

# Happy path - order confirmed
omni send --to "$recipient" --tts "[excited] Great news! Your order has been confirmed. … You'll receive it in 2 to 3 business days." --instance "$instance_id"

# Problem resolution - apologetic
omni send --to "$recipient" --tts "[apologetic] We're VERY sorry about the delay. … We're working on it RIGHT now and will have an update for you within 24 hours." --instance "$instance_id"

# Urgent notification - serious
omni send --to "$recipient" --tts "[serious] IMPORTANT security notice. … Please update your password immediately." --instance "$instance_id"
```

### Storytelling with Dramatic Pauses

```bash
#!/bin/bash
# Use emotion and pacing for engagement

instance_id="<id>"
recipient="<phone>"

omni send --to "$recipient" --tts "[mysterious] It started on a dark and stormy night … [pause] The wind howled through the trees — [dramatic] and then we heard it. … [whispered] Footsteps." --instance "$instance_id"
```

### Multilingual Support

```bash
#!/bin/bash
# Send TTS in multiple languages

instance_id="<id>"
multilingual_voice="pNInz6obpgDQGcFmaJgB"  # Adam Multilingual

# English
omni send --to <phone> --tts "Hello, how are you?" \
  --voice-id "$multilingual_voice" --instance "$instance_id"

# Portuguese
omni send --to <phone> --tts "Olá, como vai?" \
  --voice-id "$multilingual_voice" --instance "$instance_id"

# Spanish
omni send --to <phone> --tts "Hola, ¿cómo estás?" \
  --voice-id "$multilingual_voice" --instance "$instance_id"
```

### Dynamic Content

```bash
#!/bin/bash
# Generate dynamic TTS from data

weather=$(curl -s "https://api.weather.com/..." | jq -r '.temperature')
time=$(date +"%H:%M")

message="Good morning! The time is $time. Today's temperature is $weather degrees."

omni send --to <phone> --tts "$message" --instance <id>
```

### Transcription Search

TTS voice notes are automatically transcribed and searchable:

```bash
# Search for content you sent via TTS
omni messages search "appointment confirmed" --since 7d

# Output includes transcriptions:
# TIME              TYPE   CONTENT
# Feb 13, 02:05 AM  audio  [transcription] Your appointment is confirmed
```

---

## Troubleshooting

### TTS Not Working

**Check instance configuration:**
```bash
omni instances get <id> | grep tts
# Should show:
# ttsVoiceId: <some-voice-id>
# ttsModelId: eleven_multilingual_v2
```

**Verify ElevenLabs API key:**
- TTS requires ElevenLabs API key configured in Omni server
- Contact admin if TTS not available

### Voice Not Found

```bash
# List available voices to verify ID
omni tts voices --json | jq '.[] | select(.voiceId == "your-voice-id")'

# If empty, voice doesn't exist - choose from available voices
omni tts voices
```

### Poor Audio Quality

**Solutions:**
- Use shorter text (< 300 chars optimal)
- Add emotion tags: `[excited]`, `[calm]`, `[confident]`
- Use ellipses `...` and dashes `—` for natural pauses
- CAPITALIZE words for emphasis (sparingly)
- Normalize text (expand abbreviations, spell out numbers)
- Try different voices (some handle certain content better)
- Avoid URLs, code, or special formatting

**Voice-Specific Tips:**
- Match emotion to voice character (calm voices won't convincingly shout)
- Use "Creative" stability for more expressiveness
- Use "Robust" stability for consistency

### High Latency

TTS synthesis takes 1-3 seconds:
- This is normal (AI processing time)
- CLI shows "recording" presence indicator during synthesis
- Use async patterns for bulk sending

---

## Integration Examples

### Webhook to TTS

```bash
#!/bin/bash
# Webhook receiver that sends TTS

# Receive webhook data
webhook_payload='{"event": "order_shipped", "customer": "+5511999", "order": "12345"}'

event=$(echo "$webhook_payload" | jq -r '.event')
customer=$(echo "$webhook_payload" | jq -r '.customer')
order=$(echo "$webhook_payload" | jq -r '.order')

if [ "$event" == "order_shipped" ]; then
  message="Good news! Your order $order has been shipped and is on its way."
  omni send --to "$customer" --tts "$message" --instance <id>
fi
```

### CRM Integration

```bash
#!/bin/bash
# Send TTS appointment reminders from CRM

# Query CRM for tomorrow's appointments
appointments=$(curl -s "https://crm.example.com/api/appointments/tomorrow")

echo "$appointments" | jq -c '.[]' | while read -r appt; do
  customer=$(echo "$appt" | jq -r '.phone')
  time=$(echo "$appt" | jq -r '.time')
  service=$(echo "$appt" | jq -r '.service')

  message="Reminder: You have an appointment for $service tomorrow at $time. See you then!"

  omni send --to "$customer" --tts "$message" --instance <id>
  sleep 2
done
```

---

## API Response Reference

### Success Response

```json
{
  "success": true,
  "message": "TTS voice note sent",
  "data": {
    "messageId": "3EB0F06D24B9BA80AA0B8A",
    "externalMessageId": "3EB0F06D24B9BA80AA0B8A",
    "status": "sent",
    "instanceId": "e41f26ef-538a-4eaa-b5ad-dbce3d22c821",
    "to": "<recipient-id>",
    "audioSizeKb": 22.85,
    "durationMs": 2514,
    "timestamp": 1770959118964
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": "TTS synthesis failed",
  "details": {
    "code": "TTS_ERROR",
    "message": "ElevenLabs API key not configured"
  }
}
```

---

## Performance Tips

1. **Batch Processing**: Send TTS messages sequentially with delays
2. **Caching**: For repeated messages, consider pre-generating audio
3. **Async**: Don't wait for TTS completion in interactive flows
4. **Fallback**: Always have text fallback for TTS failures
5. **Monitoring**: Track TTS success rates in analytics

---

## Security & Privacy

- TTS text is sent to ElevenLabs for processing
- Don't include sensitive information (passwords, tokens, PII)
- Audio files stored in Omni media storage
- Transcriptions searchable by authorized users
- Consider data retention policies for voice notes

---

**Quick Start:**
```bash
# 1. List voices
omni tts voices

# 2. Pick a voice and send
omni send --to +5511999 --tts "Hello!" --voice-id <id> --instance <id>

# 3. Verify in chat
omni chats messages <chat-id> | grep audio
```

**That's it!** You're ready to use TTS in Omni CLI. 🎤
