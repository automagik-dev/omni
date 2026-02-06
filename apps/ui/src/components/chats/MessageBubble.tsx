import { cn, formatDateTime } from '@/lib/utils';
import { type ExtendedMessage, aggregateReactions, isMediaType } from '@/types/message';
import { Check, CheckCheck, Clock, CornerUpLeft, Forward, XCircle } from 'lucide-react';
import { MediaMessage } from './MediaMessage';
import { ReactionList } from './ReactionBadge';

interface MessageBubbleProps {
  message: ExtendedMessage;
  showSenderName?: boolean;
  isGroupChat?: boolean;
}

/**
 * Single message bubble in the conversation
 * Handles text, media, reactions, status indicators, replies, and forwards
 */
export function MessageBubble({ message, showSenderName = false, isGroupChat = false }: MessageBubbleProps) {
  const isFromMe = message.isFromMe ?? false;
  const aggregatedReactions = aggregateReactions(message.reactions);

  // Handle reaction-only messages (reactions to other messages)
  if (message.messageType === 'reaction') {
    return null; // Reactions are displayed on the parent message
  }

  // Handle system messages differently
  if (message.messageType === 'system') {
    return <SystemMessage message={message} />;
  }

  return (
    <div className={cn('flex flex-col', isFromMe ? 'items-end' : 'items-start')}>
      {/* Sender name for group chats */}
      {showSenderName && !isFromMe && isGroupChat && message.senderDisplayName && (
        <span className="mb-1 ml-1 text-xs font-medium text-primary">{message.senderDisplayName}</span>
      )}

      {/* Message content */}
      <div
        className={cn(
          'relative max-w-[70%] rounded-lg',
          isFromMe ? 'bg-primary text-primary-foreground' : 'bg-muted',
          // Less padding for stickers
          message.messageType === 'sticker' ? 'p-1' : 'px-4 py-2',
        )}
      >
        {/* Forwarded indicator */}
        {message.isForwarded && <ForwardedIndicator isFromMe={isFromMe} forwardCount={message.forwardCount} />}

        {/* Reply/Quote indicator */}
        {(message.quotedText || message.replyToMessageId) && (
          <QuotedMessage
            quotedText={message.quotedText}
            quotedSenderName={message.quotedSenderName}
            isFromMe={isFromMe}
          />
        )}

        {/* Message content based on type */}
        <MessageContent message={message} isFromMe={isFromMe} />

        {/* Timestamp and status */}
        <div className={cn('mt-1 flex items-center gap-1', isFromMe ? 'justify-end' : 'justify-start')}>
          <span className={cn('text-[10px]', isFromMe ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
            {formatDateTime(message.platformTimestamp)}
          </span>
          {isFromMe && <DeliveryStatus status={message.deliveryStatus} />}
          {message.status === 'edited' && (
            <span className={cn('text-[10px]', isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70')}>
              (edited)
            </span>
          )}
        </div>
      </div>

      {/* Reactions */}
      {aggregatedReactions.length > 0 && <ReactionList reactions={aggregatedReactions} isFromMe={isFromMe} />}
    </div>
  );
}

/**
 * Message content renderer based on type
 */
function MessageContent({ message, isFromMe }: { message: ExtendedMessage; isFromMe: boolean }) {
  // Media types
  if (isMediaType(message.messageType) || message.hasMedia) {
    return <MediaMessage message={message} isFromMe={isFromMe} />;
  }

  // Text message
  if (message.textContent) {
    return <p className="whitespace-pre-wrap break-words">{message.textContent}</p>;
  }

  // LLM-processed content (transcription, description)
  if (message.transcription) {
    return (
      <div className="space-y-1">
        <p className="whitespace-pre-wrap break-words">{message.transcription}</p>
        <span
          className={cn('text-[10px] italic', isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70')}
        >
          (transcribed)
        </span>
      </div>
    );
  }

  if (message.imageDescription) {
    return (
      <div className="space-y-1">
        <p className="whitespace-pre-wrap break-words">{message.imageDescription}</p>
        <span
          className={cn('text-[10px] italic', isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70')}
        >
          (image description)
        </span>
      </div>
    );
  }

  // Fallback: show message type
  return (
    <p className={cn('italic', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
      [{message.messageType}]
    </p>
  );
}

/**
 * Delivery status indicator (checkmarks)
 */
function DeliveryStatus({ status }: { status?: string }) {
  const iconClass = 'h-3 w-3 text-primary-foreground/60';

  switch (status) {
    case 'pending':
      return <Clock className={iconClass} />;
    case 'sent':
      return <Check className={iconClass} />;
    case 'delivered':
      return <CheckCheck className={iconClass} />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case 'failed':
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

/**
 * Forwarded message indicator
 */
function ForwardedIndicator({ isFromMe, forwardCount }: { isFromMe: boolean; forwardCount?: number }) {
  return (
    <div
      className={cn(
        'mb-1 flex items-center gap-1 text-[10px]',
        isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70',
      )}
    >
      <Forward className="h-3 w-3" />
      <span>Forwarded{forwardCount && forwardCount > 1 ? ` (${forwardCount}x)` : ''}</span>
    </div>
  );
}

/**
 * Quoted/reply message preview
 */
function QuotedMessage({
  quotedText,
  quotedSenderName,
  isFromMe,
}: { quotedText?: string | null; quotedSenderName?: string | null; isFromMe: boolean }) {
  return (
    <div
      className={cn(
        'mb-2 flex gap-2 rounded border-l-2 py-1 pl-2',
        isFromMe ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'border-primary/30 bg-primary/5',
      )}
    >
      <CornerUpLeft
        className={cn('h-3 w-3 shrink-0 mt-0.5', isFromMe ? 'text-primary-foreground/50' : 'text-primary/50')}
      />
      <div className="min-w-0 flex-1">
        {quotedSenderName && (
          <p
            className={cn(
              'truncate text-[10px] font-medium',
              isFromMe ? 'text-primary-foreground/70' : 'text-primary/70',
            )}
          >
            {quotedSenderName}
          </p>
        )}
        {quotedText && (
          <p className={cn('line-clamp-2 text-xs', isFromMe ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
            {quotedText}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * System message (join, leave, etc.)
 */
function SystemMessage({ message }: { message: ExtendedMessage }) {
  return (
    <div className="my-2 flex justify-center">
      <div className="rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
        {message.textContent || 'System message'}
      </div>
    </div>
  );
}
