import { cn, formatDateTime } from '@/lib/utils';
import type { Message } from '@omni/sdk';

interface MessageBubbleProps {
  message: Message;
}

/**
 * Single message bubble in the conversation
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isFromMe = message.isFromMe ?? false;

  return (
    <div className={cn('flex', isFromMe ? 'justify-end' : 'justify-start')}>
      <div
        className={cn('max-w-[70%] rounded-lg px-4 py-2', isFromMe ? 'bg-primary text-primary-foreground' : 'bg-muted')}
      >
        {message.textContent ? (
          <p className="whitespace-pre-wrap break-words">{message.textContent}</p>
        ) : (
          <p className={cn('italic', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            [{message.messageType}]
          </p>
        )}
        <p className={cn('mt-1 text-[10px]', isFromMe ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
          {formatDateTime(message.platformTimestamp)}
        </p>
      </div>
    </div>
  );
}
