import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ListChatsParams, SendMessageBody } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Hook for listing chats
 */
export function useChats(params?: ListChatsParams) {
  return useQuery({
    queryKey: queryKeys.chatsList(params as Record<string, unknown>),
    queryFn: () => getClient().chats.list(params),
  });
}

/**
 * Hook for getting a single chat
 */
export function useChat(id: string) {
  return useQuery({
    queryKey: queryKeys.chat(id),
    queryFn: () => getClient().chats.get(id),
    enabled: !!id,
  });
}

/**
 * Hook for getting chat messages
 */
export function useChatMessages(chatId: string, params?: { limit?: number; before?: string }) {
  return useQuery({
    queryKey: queryKeys.chatMessages(chatId, params),
    queryFn: () => getClient().chats.getMessages(chatId, params),
    enabled: !!chatId,
  });
}

/**
 * Hook for sending a message
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendMessageBody) => getClient().messages.send(body),
    onSuccess: () => {
      // Invalidate chat messages to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}
