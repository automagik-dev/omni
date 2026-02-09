import { Button } from '@/components/ui/button';
import { useReactions } from '@/hooks/useReactions';
import { cn } from '@/lib/utils';
import { Smile } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface ReactionPickerProps {
  messageId: string;
  instanceId: string;
  chatId: string;
  to: string;
  position: { x: number; y: number };
  onClose: () => void;
}

// Quick reactions (common emojis)
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

/**
 * Reaction picker popup for messages
 * Shows quick reactions and emoji picker button
 */
export function ReactionPicker({ messageId, instanceId, to, position, onClose }: ReactionPickerProps) {
  const { sendReaction } = useReactions();
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleReactionClick = async (emoji: string) => {
    try {
      await sendReaction.mutateAsync({
        instanceId,
        to,
        messageId,
        emoji,
      });
      onClose();
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <div
      ref={pickerRef}
      className={cn(
        'absolute z-50 rounded-lg border bg-popover/95 backdrop-blur-md p-2 shadow-lg',
        'animate-in fade-in zoom-in-95 duration-200',
      )}
      style={{
        top: position.y,
        left: position.x,
      }}
    >
      <div className="flex items-center gap-1">
        {QUICK_REACTIONS.map((emoji) => (
          <Button
            key={emoji}
            variant="ghost"
            size="sm"
            className="h-10 w-10 p-0 text-xl hover:scale-110 transition-transform"
            onClick={() => handleReactionClick(emoji)}
            disabled={sendReaction.isPending}
          >
            {emoji}
          </Button>
        ))}

        {/* More emojis button - TODO: integrate with full emoji picker */}
        <Button variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={onClose} title="More emojis (coming soon)">
          <Smile className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
