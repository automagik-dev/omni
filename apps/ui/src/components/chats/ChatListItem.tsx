import { Badge } from '@/components/ui/badge';
import { getChatDisplayName } from '@/lib/chat-utils';
import { cn, formatRelativeTime, truncate } from '@/lib/utils';
import type { Chat } from '@omni/sdk';
import { Hash, Megaphone, MessageCircle, Mic, Radio, User, Users } from 'lucide-react';

interface ChatListItemProps {
  chat: Chat;
  isSelected?: boolean;
  onClick?: () => void;
}

// Chat type configuration with icons, colors, and labels
const CHAT_TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; color: string; selectedColor: string }
> = {
  dm: {
    icon: MessageCircle,
    label: 'DM',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    selectedColor: 'bg-blue-400/20 text-blue-100 border-blue-400/30',
  },
  group: {
    icon: Users,
    label: 'Group',
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
    selectedColor: 'bg-green-400/20 text-green-100 border-green-400/30',
  },
  channel: {
    icon: Hash,
    label: 'Channel',
    color: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    selectedColor: 'bg-purple-400/20 text-purple-100 border-purple-400/30',
  },
  broadcast: {
    icon: Megaphone,
    label: 'Broadcast',
    color: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    selectedColor: 'bg-orange-400/20 text-orange-100 border-orange-400/30',
  },
  community: {
    icon: Radio,
    label: 'Community',
    color: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
    selectedColor: 'bg-pink-400/20 text-pink-100 border-pink-400/30',
  },
  voice: {
    icon: Mic,
    label: 'Voice',
    color: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    selectedColor: 'bg-cyan-400/20 text-cyan-100 border-cyan-400/30',
  },
  thread: {
    icon: MessageCircle,
    label: 'Thread',
    color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
    selectedColor: 'bg-indigo-400/20 text-indigo-100 border-indigo-400/30',
  },
  forum: {
    icon: Hash,
    label: 'Forum',
    color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    selectedColor: 'bg-amber-400/20 text-amber-100 border-amber-400/30',
  },
  announcement: {
    icon: Megaphone,
    label: 'Announce',
    color: 'bg-red-500/10 text-red-600 border-red-500/20',
    selectedColor: 'bg-red-400/20 text-red-100 border-red-400/30',
  },
  stage: {
    icon: Mic,
    label: 'Stage',
    color: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
    selectedColor: 'bg-violet-400/20 text-violet-100 border-violet-400/30',
  },
};

const DEFAULT_CONFIG = {
  icon: MessageCircle,
  label: 'Chat',
  color: 'bg-muted text-muted-foreground border-muted',
  selectedColor: 'bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30',
};

// Style helpers
const getItemClass = (isSelected: boolean, chatType: string) => {
  const config = CHAT_TYPE_CONFIG[chatType];
  // Add subtle border color based on chat type when not selected
  const borderHint =
    !isSelected && config ? `border-l-2 ${config.color.split(' ')[1]?.replace('text-', 'border-') || ''}` : '';
  return cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors',
    isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
    borderHint,
  );
};

const getAvatarClass = (isSelected: boolean, chatType: string) => {
  const config = CHAT_TYPE_CONFIG[chatType] || DEFAULT_CONFIG;
  return cn(
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
    isSelected ? 'bg-primary-foreground/20' : config.color.split(' ')[0],
  );
};

const getIconClass = (isSelected: boolean, chatType: string) => {
  const config = CHAT_TYPE_CONFIG[chatType] || DEFAULT_CONFIG;
  return cn('h-5 w-5', isSelected ? 'text-primary-foreground' : config.color.split(' ')[1]);
};

const getSecondaryTextClass = (isSelected: boolean) =>
  isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground';

/**
 * Single chat item in the chat list
 * Shows visual indicators for chat type with distinct colors and icons
 */
export function ChatListItem({ chat, isSelected = false, onClick }: ChatListItemProps) {
  const secondaryTextClass = getSecondaryTextClass(isSelected);
  const config = CHAT_TYPE_CONFIG[chat.chatType] || DEFAULT_CONFIG;
  const ChatTypeIcon = config.icon;

  // Generate accessible label
  const chatLabel = `${getChatDisplayName(chat)}, ${config.label}${chat.isArchived ? ', archived' : ''}${chat.description ? `, ${chat.description}` : ', no messages'}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={getItemClass(isSelected, chat.chatType)}
      role="option"
      aria-selected={isSelected}
      aria-label={chatLabel}
    >
      {/* Avatar */}
      <div className={getAvatarClass(isSelected, chat.chatType)}>
        {chat.avatarUrl ? (
          <img src={chat.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : chat.chatType === 'dm' ? (
          <User className={getIconClass(isSelected, chat.chatType)} aria-hidden="true" />
        ) : (
          <ChatTypeIcon className={getIconClass(isSelected, chat.chatType)} aria-hidden="true" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('truncate font-medium', !isSelected && 'text-foreground')}>
            {getChatDisplayName(chat)}
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

        {/* Tags with styled chat type badge */}
        <div className="mt-1 flex items-center gap-1">
          <Badge
            variant="outline"
            className={cn('gap-1 border px-1.5 py-0 text-[10px]', isSelected ? config.selectedColor : config.color)}
          >
            <ChatTypeIcon className="h-3 w-3" aria-hidden="true" />
            {config.label}
          </Badge>
          {chat.isArchived && (
            <Badge
              variant="outline"
              className={cn('text-[10px]', isSelected && 'border-primary-foreground/30 text-primary-foreground')}
            >
              Archived
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
