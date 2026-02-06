import { Button } from '@/components/ui/button';
import type { Chat, Instance } from '@omni/sdk';
import { ArrowLeft, Bot, BotOff, User } from 'lucide-react';

interface ChatHeaderProps {
  chat: Chat;
  instance?: Instance | null;
  onBack: () => void;
  agentPaused?: boolean;
  onToggleAgent?: () => void;
  agentToggleLoading?: boolean;
}

/**
 * Chat header with back button, info, and agent toggle
 */
export function ChatHeader({
  chat,
  instance,
  onBack,
  agentPaused,
  onToggleAgent,
  agentToggleLoading,
}: ChatHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Avatar */}
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          {chat.avatarUrl ? (
            <img src={chat.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <User className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        {/* Info */}
        <div>
          <h2 className="font-semibold">{chat.name ?? chat.externalId}</h2>
          <p className="text-sm text-muted-foreground">
            {chat.channel} · {instance?.name ?? 'Unknown instance'}
          </p>
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
