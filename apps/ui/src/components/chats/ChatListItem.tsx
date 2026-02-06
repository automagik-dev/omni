import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime, truncate } from '@/lib/utils';
import type { Chat } from '@omni/sdk';
import { User } from 'lucide-react';

interface ChatListItemProps {
  chat: Chat;
  isSelected?: boolean;
  onClick?: () => void;
}

// Style helpers to reduce cognitive complexity
const getItemClass = (isSelected: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors',
    isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
  );

const getAvatarClass = (isSelected: boolean) =>
  cn(
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
    isSelected ? 'bg-primary-foreground/20' : 'bg-muted',
  );

const getIconClass = (isSelected: boolean) =>
  cn('h-5 w-5', isSelected ? 'text-primary-foreground' : 'text-muted-foreground');

const getSecondaryTextClass = (isSelected: boolean) =>
  isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground';

const getBadgeClass = (isSelected: boolean) =>
  cn('text-[10px]', isSelected && 'border-primary-foreground/30 text-primary-foreground');

/**
 * Single chat item in the chat list
 */
export function ChatListItem({ chat, isSelected = false, onClick }: ChatListItemProps) {
  const secondaryTextClass = getSecondaryTextClass(isSelected);

  return (
    <button type="button" onClick={onClick} className={getItemClass(isSelected)}>
      {/* Avatar */}
      <div className={getAvatarClass(isSelected)}>
        {chat.avatarUrl ? (
          <img src={chat.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <User className={getIconClass(isSelected)} />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('truncate font-medium', !isSelected && 'text-foreground')}>
            {chat.name ?? chat.externalId}
          </span>
          <span className={cn('shrink-0 text-xs', secondaryTextClass)}>{formatRelativeTime(chat.updatedAt)}</span>
        </div>

        <div className="flex items-center gap-2">
          {chat.description ? (
            <span className={cn('truncate text-sm', secondaryTextClass)}>{truncate(chat.description, 40)}</span>
          ) : (
            <span
              className={cn('text-sm italic', isSelected ? 'text-primary-foreground/50' : 'text-muted-foreground/50')}
            >
              No messages
            </span>
          )}
        </div>

        {/* Tags */}
        <div className="mt-1 flex items-center gap-1">
          <Badge variant={isSelected ? 'outline' : 'secondary'} className={getBadgeClass(isSelected)}>
            {chat.chatType}
          </Badge>
          {chat.isArchived && (
            <Badge variant="outline" className={getBadgeClass(isSelected)}>
              Archived
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
