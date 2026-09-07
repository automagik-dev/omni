/**
 * Transcription output guard.
 *
 * Chat-completion audio models (gpt-audio-*) answer conversationally when the
 * audio is missing or undecodable instead of failing: HTTP 200 with "Claro,
 * por favor me diga o que você gostaria que fosse transcrito…". Without a
 * content check that reply masquerades as a successful transcription and
 * short-circuits the real STT fallback chain (issue #942).
 *
 * Patterns are anchored to the string start and only applied to short outputs
 * so legitimate transcripts that happen to open with "Claro" survive.
 */

/**
 * Meta-responses are short requests for input or refusals; real transcripts
 * that trip a pattern opener are overwhelmingly longer than this.
 */
const META_RESPONSE_MAX_LENGTH = 320;

const META_RESPONSE_PATTERNS: readonly RegExp[] = [
  // pt-BR: "Claro, por favor me diga/envie…"
  /^claro[,!.]?\s+(por favor|me (diga|envie|mande|informe|forneça)|envie|preciso|posso ajudar)/i,
  // pt-BR: apologies and refusals
  /^(desculpe|sinto muito|perd[ãa]o)\b/i,
  /^n[ãa]o (consigo|posso|tenho acesso|h[áa] [áa]udio)/i,
  /^parece que (n[ãa]o|o [áa]udio)/i,
  /^infelizmente\b/i,
  // pt-BR: "Por favor, envie/forneça o áudio…"
  /^por favor,?\s+(envie|forne[çc]a|compartilhe|me (diga|envie|mande))/i,
  // en: "Sure, please provide…"
  /^sure[,!.]?\s+(please|provide|send|go ahead)/i,
  // en: apologies and refusals
  /^(i['’]?m sorry|sorry[,.]|i apologize)\b/i,
  /^i (can['’]?t|cannot|am unable|don['’]?t have access|do not have access)\b/i,
  // en: "It seems there is no audio…"
  /^it (seems|appears|looks like)\b.{0,40}\b(no|not|any|missing|unable|audio)\b/i,
  /^unfortunately\b/i,
  // en: "Please provide/send/upload the audio…"
  /^please (provide|send|share|upload|attach)\b/i,
  /^could you (please )?(provide|send|share|upload)\b/i,
];

/**
 * Judge whether a model's output is a usable transcript.
 *
 * Returns a human-readable rejection reason when the output is empty or reads
 * as an assistant meta-response instead of a transcription, or `undefined`
 * when the text should be accepted.
 */
export function detectInvalidTranscription(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return 'Transcription returned empty text';
  if (trimmed.length <= META_RESPONSE_MAX_LENGTH && META_RESPONSE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return `Model returned a conversational reply instead of a transcript: "${trimmed.slice(0, 120)}"`;
  }
  return undefined;
}
