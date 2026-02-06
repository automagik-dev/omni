import { ChatList, ChatPanel } from '@/components/chats';
import { Spinner } from '@/components/ui/spinner';
import { useChat } from '@/hooks/useChats';
import type { Chat } from '@omni/sdk';
import { MessageSquare } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

export function Chats() {
  const { id: chatId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const instanceId = searchParams.get('instanceId') ?? undefined;

  // Fetch the selected chat if we have an ID in the URL
  const { data: selectedChat, isLoading: chatLoading } = useChat(chatId ?? '');

  const handleInstanceChange = (newInstanceId: string | undefined) => {
    setSearchParams((prev) => {
      if (newInstanceId) {
        prev.set('instanceId', newInstanceId);
      } else {
        prev.delete('instanceId');
      }
      return prev;
    });
  };

  const handleSelectChat = (chat: Chat) => {
    // Navigate to /chats/:id, preserving instance filter
    const params = instanceId ? `?instanceId=${instanceId}` : '';
    navigate(`/chats/${chat.id}${params}`);
  };

  const handleBack = () => {
    // Navigate back to /chats, preserving instance filter
    const params = instanceId ? `?instanceId=${instanceId}` : '';
    navigate(`/chats${params}`);
  };

  return (
    <div className="flex h-full">
      {/* Chat list (left panel) */}
      <div className="w-80 shrink-0">
        <ChatList
          selectedChatId={chatId}
          onSelectChat={handleSelectChat}
          instanceId={instanceId}
          onInstanceChange={handleInstanceChange}
        />
      </div>

      {/* Chat panel (right panel) */}
      <div className="flex-1">
        {chatId ? (
          chatLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : selectedChat ? (
            <ChatPanel chat={selectedChat} onBack={handleBack} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <p>Chat not found</p>
            </div>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="h-16 w-16" />
            <p className="mt-4 text-lg">Select a chat to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}
