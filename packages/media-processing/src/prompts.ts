/**
 * Centralized LLM prompt constants for media processing.
 *
 * Change prompts here instead of hunting through individual processors.
 * Runtime overrides are available via globalSettings (prompt.* keys).
 */

// ============================================================================
// Image Description
// ============================================================================

/** Default prompt for image description (Gemini Vision / OpenAI fallback) */
export const IMAGE_DESCRIPTION_PROMPT = `Analyze this image and provide a detailed description that would help someone who cannot see it understand what's in it.

Include:
1. Main subject(s) and their appearance
2. Setting/environment
3. Any text visible in the image
4. Notable details, colors, or objects
5. The overall mood or context

Be concise but thorough. If there's text in the image, transcribe it exactly.
Respond in the same language as any text in the image, or in Portuguese if no text is present.`;

// ============================================================================
// Video Description
// ============================================================================

/** Default prompt for video description (Gemini Flash) */
export const VIDEO_DESCRIPTION_PROMPT = `Analyze this video and provide a comprehensive description.

Include:
1. Main subjects and what they're doing
2. Setting/environment
3. Key actions or events that occur
4. Any speech or dialogue (transcribe if present)
5. Text visible in the video
6. Overall context and purpose

If there is speech in the video, transcribe it accurately.
Respond in Portuguese if no specific language is detected in the audio.`;

// ============================================================================
// Document OCR
// ============================================================================

/** Default prompt for document OCR fallback (Gemini Vision on scanned PDFs) */
export const DOCUMENT_OCR_PROMPT = `Extract and transcribe all text content from this document image.

Instructions:
1. Transcribe ALL visible text exactly as written
2. Preserve the document structure (headings, paragraphs, lists)
3. Use markdown formatting for structure
4. If there are tables, format them as markdown tables
5. If there are images with captions, note them as [Image: caption]
6. Maintain the reading order (top to bottom, left to right)

Output the complete text content in markdown format.`;

// ============================================================================
// Response Gate
// ============================================================================

/** Default prompt for the smart response gate (LLM pre-filter) */
export const RESPONSE_GATE_PROMPT = `You are a response gate for an AI assistant called "{agentName}".
Given the following buffered messages from a {chatType} chat, decide whether the assistant should respond.

Rules:
- If someone is directly asking the assistant a question or requesting action → respond
- If someone mentions the assistant's name in passing (e.g. "I told {agentName} yesterday") → skip
- If the messages are just a conversation between others that doesn't need the assistant → skip
- When in doubt → respond

Reply with ONLY one word: "respond" or "skip"

Messages:
{messages}`;

// ============================================================================
// Settings Keys (for globalSettings runtime overrides)
// ============================================================================

/** Settings keys for prompt overrides. Null/empty value = use code default. */
export const PROMPT_KEYS = {
  imageDescription: 'prompt.image_description',
  videoDescription: 'prompt.video_description',
  documentOcr: 'prompt.document_ocr',
  responseGate: 'prompt.response_gate',
} as const;
