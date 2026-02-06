import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Chat, Instance } from '@omni/sdk';
import { ArrowLeft, Bot, BotOff, Hash, Megaphone, MessageCircle, Mic, Radio, User, Users } from 'lucide-react';

interface ChatHeaderProps {
  chat: Chat;
  instance?: Instance | null;
  onBack: () => void;
  agentPaused?: boolean;
  onToggleAgent?: () => void;
  agentToggleLoading?: boolean;
  participantCount?: number;
}

// Chat type configuration
const CHAT_TYPE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  dm: { icon: MessageCircle, label: 'Direct Message', color: 'text-blue-500' },
  group: { icon: Users, label: 'Group', color: 'text-green-500' },
  channel: { icon: Hash, label: 'Channel', color: 'text-purple-500' },
  broadcast: { icon: Megaphone, label: 'Broadcast', color: 'text-orange-500' },
  community: { icon: Radio, label: 'Community', color: 'text-pink-500' },
  voice: { icon: Mic, label: 'Voice', color: 'text-cyan-500' },
  thread: { icon: MessageCircle, label: 'Thread', color: 'text-indigo-500' },
  forum: { icon: Hash, label: 'Forum', color: 'text-amber-500' },
  announcement: { icon: Megaphone, label: 'Announcement', color: 'text-red-500' },
  stage: { icon: Mic, label: 'Stage', color: 'text-violet-500' },
};

const DEFAULT_CONFIG = { icon: MessageCircle, label: 'Chat', color: 'text-muted-foreground' };

/**
 * Chat header with back button, chat type info, and agent toggle
 */
export function ChatHeader({
  chat,
  instance,
  onBack,
  agentPaused,
  onToggleAgent,
  agentToggleLoading,
  participantCount,
}: ChatHeaderProps) {
  const config = CHAT_TYPE_CONFIG[chat.chatType] || DEFAULT_CONFIG;
  const ChatTypeIcon = config.icon;
  const isGroupType = ['group', 'channel', 'community', 'broadcast', 'forum'].includes(chat.chatType);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Avatar with chat type indicator */}
        <div className="relative">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            {chat.avatarUrl ? (
              <img src={chat.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : chat.chatType === 'dm' ? (
              <User className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChatTypeIcon className={cn('h-5 w-5', config.color)} />
            )}
          </div>
          {/* Small chat type indicator badge on avatar */}
          {isGroupType && (
            <div
              className={cn(
                'absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card',
                chat.chatType === 'group' && 'bg-green-500',
                chat.chatType === 'channel' && 'bg-purple-500',
                chat.chatType === 'broadcast' && 'bg-orange-500',
                chat.chatType === 'community' && 'bg-pink-500',
                chat.chatType === 'forum' && 'bg-amber-500',
              )}
            >
              <ChatTypeIcon className="h-2.5 w-2.5 text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{chat.name ?? chat.externalId}</h2>
            {chat.chatType === 'broadcast' && (
              <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20 text-[10px]">
                <Megaphone className="mr-1 h-3 w-3" />
                Broadcast
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ChatTypeIcon className={cn('h-3.5 w-3.5', config.color)} />
            <span>{config.label}</span>
            <span>·</span>
            <span>{instance?.name ?? 'Unknown instance'}</span>
            {participantCount !== undefined && participantCount > 0 && (
              <>
                <span>·</span>
                <Users className="h-3.5 w-3.5" />
                <span>{participantCount} members</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Agent toggle */}
      {onToggleAgent && (
        <Button
          variant={agentPaused ? 'outline' : 'secondary'}
          size="sm"
          onClick={onToggleAgent}
          disabled={agentToggleLoading}
        >
          {agentPaused ? (
            <>
              <BotOff className="mr-2 h-4 w-4" />
              Agent Paused
            </>
          ) : (
            <>
              <Bot className="mr-2 h-4 w-4" />
              Agent Active
            </>
          )}
        </Button>
      )}
    </header>
  );
}
