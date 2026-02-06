import { ChatList, ChatPanel } from '@/components/chats';
import type { Chat } from '@omni/sdk';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function Chats() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const instanceId = searchParams.get('instanceId') ?? undefined;

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
    setSelectedChat(chat);
  };

  const handleBack = () => {
    setSelectedChat(null);
  };

  return (
    <div className="flex h-full">
      {/* Chat list (left panel) */}
      <div className="w-80 shrink-0">
        <ChatList
          selectedChatId={selectedChat?.id}
          onSelectChat={handleSelectChat}
          instanceId={instanceId}
          onInstanceChange={handleInstanceChange}
        />
      </div>

      {/* Chat panel (right panel) */}
      <div className="flex-1">
        {selectedChat ? (
          <ChatPanel chat={selectedChat} onBack={handleBack} />
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
