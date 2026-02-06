import { ChatPanel } from '@/components/chats';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useChat } from '@/hooks/useChats';
import { useNavigate, useParams } from 'react-router-dom';

export function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: chat, isLoading } = useChat(id!);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <p className="text-muted-foreground">Chat not found</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/chats')}>
          Back to Chats
        </Button>
      </div>
    );
  }

  return <ChatPanel chat={chat} onBack={() => navigate('/chats')} />;
}
