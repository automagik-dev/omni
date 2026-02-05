import { Header } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useChat, useChatMessages, useSendMessage } from '@/hooks/useChats';
import { useInstance } from '@/hooks/useInstances';
import { cn, formatDateTime } from '@/lib/utils';
import { ArrowLeft, Send } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [messageText, setMessageText] = useState('');

  const { data: chat, isLoading: loadingChat } = useChat(id!);
  const { data: messages, isLoading: loadingMessages } = useChatMessages(id!, { limit: 50 });
  const { data: instance } = useInstance(chat?.instanceId ?? '');
  const sendMessage = useSendMessage();

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !chat) return;

    try {
      await sendMessage.mutateAsync({
        instanceId: chat.instanceId,
        to: chat.externalId,
        text: messageText.trim(),
      });
      setMessageText('');
    } catch {
      // Error is handled by mutation
    }
  };

  if (loadingChat) {
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

  return (
    <div className="flex h-full flex-col">
      <Header
        title={chat.name ?? chat.externalId}
        subtitle={`${chat.channel} · ${instance?.name ?? 'Unknown instance'}`}
        actions={
          <Button variant="ghost" onClick={() => navigate('/chats')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6">
        {loadingMessages ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : messages?.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages?.map((message) => (
              <div key={message.id} className={cn('flex', message.isFromMe ? 'justify-end' : 'justify-start')}>
                <Card className={cn('max-w-[70%]', message.isFromMe ? 'bg-primary text-primary-foreground' : '')}>
                  <CardContent className="p-3">
                    {message.textContent ? (
                      <p className="whitespace-pre-wrap">{message.textContent}</p>
                    ) : (
                      <p className="italic text-muted-foreground">[{message.messageType}]</p>
                    )}
                    <p
                      className={cn(
                        'mt-1 text-xs',
                        message.isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      {formatDateTime(message.platformTimestamp)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Message input */}
      <div className="border-t p-4">
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            disabled={sendMessage.isPending}
            className="flex-1"
          />
          <Button type="submit" disabled={sendMessage.isPending || !messageText.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
        {sendMessage.error && (
          <p className="mt-2 text-sm text-destructive">
            {sendMessage.error instanceof Error ? sendMessage.error.message : 'Failed to send message'}
          </p>
        )}
      </div>
    </div>
  );
}
