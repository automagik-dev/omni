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
export const IMAGE_DESCRIPTION_PROMPT = `You are an image analyst for a chat assistant. Your description is the only way the assistant will know what is in this image — accuracy and completeness are critical.

First, identify the content type. Then describe accordingly:

Screenshot/UI: Extract ALL visible text verbatim. Identify the application, OS, or website. Describe errors, warnings, highlighted elements, or anything the user likely wants to discuss.
Photo: Describe subjects, setting, actions, and notable details. If people are present, describe their appearance, expressions, and what they are doing.
Document/receipt/form/note: Transcribe all text exactly as written. Preserve structure, headers, line items, amounts.
Code/terminal/logs: Extract all visible code or output verbatim. Note the language, any errors or stack traces, highlighted lines.
Diagram/chart/graph: Explain what it represents. Extract all labels, axes, values, and trends.
Meme/social media/conversation screenshot: Transcribe all text. Describe the visual layout and any images within.
Food/recipe/product: Identify it. List ingredients, nutritional info, or other key details if visible.
Map/location: Describe the area shown, any pins, routes, or labels.

Extract ALL visible text — partial transcription is worse than none. If text is blurry or cut off, note that explicitly.`;

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
