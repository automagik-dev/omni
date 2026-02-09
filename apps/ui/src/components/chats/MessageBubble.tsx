import { Button } from '@/components/ui/button';
import { cn, formatDateTime } from '@/lib/utils';
import { type ExtendedMessage, aggregateReactions, isMediaType } from '@/types/message';
import { Check, CheckCheck, Clock, Copy, CornerUpLeft, Edit, Forward, Smile, Trash, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MediaMessage } from './MediaMessage';
import { ReactionList } from './ReactionBadge';
import { ReactionPicker } from './ReactionPicker';

interface MessageBubbleProps {
  message: ExtendedMessage;
  showSenderName?: boolean;
  isGroupChat?: boolean;
  instanceId: string;
  to: string;
}

/**
 * Single message bubble in the conversation
 * Handles text, media, reactions, status indicators, replies, and forwards
 */
export function MessageBubble({
  message,
  showSenderName = false,
  isGroupChat = false,
  instanceId,
  to,
}: MessageBubbleProps) {
  const isFromMe = message.isFromMe ?? false;
  const aggregatedReactions = aggregateReactions(message.reactions);
  const [isHovering, setIsHovering] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [reactionPickerPosition, setReactionPickerPosition] = useState({ x: 0, y: 0 });

  // Handle reaction-only messages (reactions to other messages)
  if (message.messageType === 'reaction') {
    return null; // Reactions are displayed on the parent message
  }

  // Handle system messages differently
  if (message.messageType === 'system') {
    return <SystemMessage message={message} />;
  }

  const handleReactClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setReactionPickerPosition({
      x: rect.left,
      y: rect.top - 60, // Position above the button
    });
    setShowReactionPicker(true);
  };

  const handleCopyClick = () => {
    const text = message.textContent || '';
    if (text) {
      navigator.clipboard.writeText(text);
      toast.success('Message copied to clipboard');
    }
  };

  const handleEditClick = () => {
    toast.info('Edit feature coming soon');
  };

  const handleDeleteClick = () => {
    toast.info('Delete feature coming soon');
  };

  const handleForwardClick = () => {
    toast.info('Forward feature coming soon');
  };

  // Generate accessible label for screen readers
  const messageLabel = `Message from ${isFromMe ? 'you' : message.senderDisplayName || 'contact'} at ${formatDateTime(message.platformTimestamp)}${message.isForwarded ? ', forwarded' : ''}${message.status === 'edited' ? ', edited' : ''}`;

  return (
    <div className={cn('group flex flex-col', isFromMe ? 'items-end' : 'items-start')}>
      {/* Sender name for group chats */}
      {showSenderName && !isFromMe && isGroupChat && message.senderDisplayName && (
        <span className="mb-1 ml-1 text-xs font-medium text-primary/80">{message.senderDisplayName}</span>
      )}

      {/* Message container with hover actions */}
      <div
        className="relative"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        role="article"
        aria-label={messageLabel}
      >
        {/* Hover action bar */}
        {(isHovering || showReactionPicker) && (
          <div
            className={cn(
              'absolute -top-10 flex gap-1 rounded-lg bg-card/95 backdrop-blur-md border p-1 shadow-lg z-10',
              'animate-in fade-in slide-in-from-bottom-2 duration-200',
              isFromMe ? 'right-2' : 'left-2',
            )}
          >
            <ActionButton icon={Smile} onClick={handleReactClick} label="React" />
            <ActionButton icon={Copy} onClick={handleCopyClick} label="Copy" />
            <ActionButton icon={Forward} onClick={handleForwardClick} label="Forward" />
            {isFromMe && <ActionButton icon={Edit} onClick={handleEditClick} label="Edit" />}
            {isFromMe && <ActionButton icon={Trash} onClick={handleDeleteClick} label="Delete" />}
          </div>
        )}

        {/* Message content */}
        <div
          className={cn(
            'relative max-w-[70%] rounded-xl shadow-sm backdrop-blur-sm transition-all',
            isFromMe
              ? 'bg-primary/10 border-l-2 border-primary/30 text-foreground'
              : 'bg-muted/50 border-l-2 border-muted-foreground/20',
            // Conditional padding based on content type
            message.messageType === 'sticker'
              ? 'p-2' // Better padding for stickers (8px vs 4px)
              : isMediaType(message.messageType) || message.hasMedia
                ? 'p-0' // No padding for media - handled internally
                : 'px-4 py-2', // Normal text messages
            'group-hover:shadow-md',
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
            <span className="text-[10px] text-muted-foreground/60">{formatDateTime(message.platformTimestamp)}</span>
            {isFromMe && <DeliveryStatus status={message.deliveryStatus} />}
            {message.status === 'edited' && <span className="text-[10px] text-muted-foreground/60">(edited)</span>}
          </div>
        </div>

        {/* Reactions */}
        {aggregatedReactions.length > 0 && <ReactionList reactions={aggregatedReactions} isFromMe={isFromMe} />}
      </div>

      {/* Reaction picker */}
      {showReactionPicker && (
        <ReactionPicker
          messageId={message.externalId}
          instanceId={instanceId}
          chatId={message.chatId}
          to={to}
          position={reactionPickerPosition}
          onClose={() => setShowReactionPicker(false)}
        />
      )}
    </div>
  );
}

/**
 * Action button for hover bar
 */
function ActionButton({
  icon: Icon,
  onClick,
  label,
}: {
  icon: React.ElementType;
  onClick: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 hover:bg-accent"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
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
    return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.textContent}</p>;
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

  if (message.videoDescription) {
    return (
      <div className="space-y-1">
        <p className="whitespace-pre-wrap break-words">{message.videoDescription}</p>
        <span
          className={cn('text-[10px] italic', isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70')}
        >
          (video description)
        </span>
      </div>
    );
  }

  if (message.documentExtraction) {
    return (
      <div className="space-y-1">
        <p className="whitespace-pre-wrap break-words line-clamp-6">{message.documentExtraction}</p>
        <span
          className={cn('text-[10px] italic', isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70')}
        >
          (document extraction)
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
