/**
 * Type declarations for baileys_helpers
 */

declare module 'baileys_helpers' {
  import type { WASocket } from '@whiskeysockets/baileys';

  interface HydratedTemplateContent {
    text?: string;
    footer?: string;
    title?: string;
    subtitle?: string;
    image?: { url: string } | proto.Message.IImageMessage;
    video?: { url: string } | proto.Message.IVideoMessage;
    document?: { url: string } | proto.Message.IDocumentMessage;
    interactiveButtons?: Array<{
      name: string;
      buttonParamsJson: string;
    }>;
    contextInfo?: proto.IContextInfo;
  }

  interface HydratedTemplateOptions {
    messageId?: string;
    timestamp?: Date;
    additionalNodes?: unknown[];
    additionalAttributes?: Record<string, string>;
    useCachedGroupMetadata?: boolean;
    statusJidList?: string[];
  }

  interface HydratedTemplateResult {
    key: {
      id: string;
      remoteJid: string;
      fromMe: boolean;
    };
    message: proto.IMessage;
    messageTimestamp: number;
  }

  export function hydratedTemplate(
    sock: WASocket,
    jid: string,
    content: HydratedTemplateContent,
    options?: HydratedTemplateOptions,
  ): Promise<HydratedTemplateResult>;

  export function sendButtons(
    sock: WASocket,
    jid: string,
    data: {
      text?: string;
      footer?: string;
      title?: string;
      subtitle?: string;
      buttons?: Array<{ id: string; text: string } | { name: string; buttonParamsJson: string }>;
      contextInfo?: proto.IContextInfo;
    },
    options?: HydratedTemplateOptions,
  ): Promise<HydratedTemplateResult>;

  export function setLogger(logger: unknown): void;

  export function getButtonType(message: proto.IMessage): 'list' | 'buttons' | 'native_flow' | null;

  export function getButtonArgs(message: proto.IMessage): {
    tag: string;
    attrs: Record<string, string>;
    content?: unknown[];
  };

  export function validateInteractiveMessageContent(content: unknown): {
    errors: string[];
    warnings: string[];
    valid: boolean;
  };

  export class InteractiveValidationError extends Error {
    context?: string;
    errors: string[];
    warnings: string[];
    example?: unknown;
    toJSON(): Record<string, unknown>;
    formatDetailed(): string;
  }
}
