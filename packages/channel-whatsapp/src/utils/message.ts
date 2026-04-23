import type { WAMessage, proto } from 'baileys';

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
