import type { WAMessage, proto } from 'baileys';

type MessageContent = proto.IMessage;

/**
 * FutureProofMessage envelopes WhatsApp wraps real content in. Mirrors Baileys'
 * `normalizeMessageContent` list plus `deviceSentMessage` (own-device sync).
 * Envelopes nest in any order (e.g. own edit from the phone:
 * deviceSentMessage → editedMessage → protocolMessage), so unwrap iteratively
 * instead of special-casing each wrapper (#1061).
 */
const ENVELOPE_KEYS = [
  'deviceSentMessage',
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'editedMessage',
  'documentWithCaptionMessage',
  'associatedChildMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
] as const;

export function unwrapEnvelopes(message: MessageContent): MessageContent {
  let current = message;
  for (let depth = 0; depth < 5; depth++) {
    const record = current as Record<string, { message?: MessageContent | null } | null | undefined>;
    const key = ENVELOPE_KEYS.find((k) => record[k]?.message);
    if (!key) break;
    current = record[key]?.message as MessageContent;
  }
  return current;
}

/**
 * The same message with its content unwrapped from envelopes (key unchanged),
 * so media detection and download see e.g. the `imageMessage` of an HD photo
 * (`associatedChildMessage`) or of an own-device send (`deviceSentMessage`,
 * which Baileys' own normalization does not unwrap) (#1280).
 */
export function withUnwrappedContent(msg: WAMessage): WAMessage {
  if (!msg.message) return msg;
  const message = unwrapEnvelopes(msg.message);
  return message === msg.message ? msg : { ...msg, message };
}

export function getDocumentMessage(
  message: WAMessage['message'] | null | undefined,
): proto.Message.IDocumentMessage | null | undefined {
  return message?.documentMessage ?? message?.documentWithCaptionMessage?.message?.documentMessage;
}

/**
 * Resolve contextInfo from text and caption-bearing message types.
 */
export function getMessageContextInfo(msg: WAMessage): proto.IContextInfo | null | undefined {
  const message = msg.message;
  return (
    message?.extendedTextMessage?.contextInfo ??
    message?.imageMessage?.contextInfo ??
    message?.videoMessage?.contextInfo ??
    getDocumentMessage(message)?.contextInfo
  );
}
