/**
 * Inbound Message Sanitizer
 *
 * Sanitizes inbound messages before they enter the processing pipeline.
 * - Rejects null bytes (\0) with WARN log
 * - Strips unsafe control characters (C0 except \n, \r, \t)
 * - Normalizes Unicode to NFC form
 * - Enforces max message length
 */

import type { Logger } from '@omni/core';

export interface SanitizeOptions {
  maxLengthBytes?: number;
}

const DEFAULT_MAX_LENGTH = 65_536; // 64KB

const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// C0 control characters (0x00-0x1F) except \t(0x09), \n(0x0A), \r(0x0D)
// Also strip DEL (0x7F) and C1 control chars (0x80-0x9F)
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char matching for sanitization
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

// Null byte specifically
const NULL_BYTE_RE = /\0/;

export interface SanitizeResult {
  ok: boolean;
  text: string;
  rejected?: 'null_byte' | 'too_long';
}

/**
 * Sanitize an inbound message text.
 *
 * Returns { ok: true, text } on success, { ok: false, rejected } when message should be dropped.
 */
export function sanitizeMessage(
  text: string,
  logger: Logger,
  opts?: SanitizeOptions & { instanceId?: string; messageId?: string },
): SanitizeResult {
  const maxLength = opts?.maxLengthBytes ?? DEFAULT_MAX_LENGTH;

  // 1. Reject null bytes
  if (NULL_BYTE_RE.test(text)) {
    logger.warn('message_rejected_null_byte', {
      event: 'message_rejected',
      reason: 'null_byte',
      instanceId: opts?.instanceId,
      messageId: opts?.messageId,
      textLengthChars: text.length,
    });
    return { ok: false, text: '', rejected: 'null_byte' };
  }

  // 2. Enforce max length in UTF-8 bytes (matching the option name maxLengthBytes).
  // text.length counts UTF-16 code units; multibyte characters (e.g. CJK, emoji)
  // would bypass the limit if we used that. Buffer.byteLength gives the true UTF-8 size.
  const textByteLength = Buffer.byteLength(text, 'utf8');
  if (textByteLength > maxLength) {
    logger.warn('message_rejected_too_long', {
      event: 'message_rejected',
      reason: 'too_long',
      instanceId: opts?.instanceId,
      messageId: opts?.messageId,
      textLengthChars: text.length,
      textLengthBytes: textByteLength,
      maxLength,
    });
    return { ok: false, text: '', rejected: 'too_long' };
  }

  // 3. Strip unsafe control characters
  let cleaned = text.replace(CONTROL_CHARS_RE, '');

  // 4. Normalize Unicode to NFC
  cleaned = cleaned.normalize('NFC');

  return { ok: true, text: cleaned };
}

/**
 * Validate an instance ID format for cache keys.
 */
export function isValidInstanceId(instanceId: string): boolean {
  return INSTANCE_ID_RE.test(instanceId);
}
