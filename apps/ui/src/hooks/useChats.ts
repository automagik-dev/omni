import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ChatParticipant, ListChatsParams, SendMessageBody } from '@omni/sdk';
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
 * Hook for getting chat participants
 */
export function useChatParticipants(chatId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chatParticipants(chatId ?? ''),
    queryFn: async () => {
      if (!chatId) return [] as ChatParticipant[];
      return getClient().chats.listParticipants(chatId);
    },
    enabled: !!chatId,
  });
}

/**
 * Hook for sending a text message
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

interface SendMediaParams {
  instanceId: string;
  to: string;
  file: File;
  caption?: string;
}

/**
 * Hook for sending media messages
 */
export function useSendMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ instanceId, to, file, caption }: SendMediaParams) => {
      // Determine media type from file MIME type
      const mimeType = file.type;
      let type: 'image' | 'audio' | 'video' | 'document' = 'document';

      if (mimeType.startsWith('image/')) type = 'image';
      else if (mimeType.startsWith('audio/')) type = 'audio';
      else if (mimeType.startsWith('video/')) type = 'video';

      // Convert file to base64
      const base64 = await fileToBase64(file);

      return getClient().messages.sendMedia({
        instanceId,
        to,
        type,
        base64,
        filename: file.name,
        caption,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

/**
 * Convert a File to base64 string (data URL)
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 part from data URL (remove "data:mime/type;base64," prefix)
      const base64 = result.split(',')[1];
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
