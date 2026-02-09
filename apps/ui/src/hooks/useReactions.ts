import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { SendReactionBody } from '@omni/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Hook for managing message reactions
 */
export function useReactions() {
  const queryClient = useQueryClient();

  const sendReaction = useMutation({
    mutationFn: async ({ instanceId, to, messageId, emoji }: SendReactionBody) => {
      return getClient().messages.sendReaction({ instanceId, to, messageId, emoji });
    },
    onSuccess: () => {
      // Invalidate chats to refresh messages with new reactions
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

  const removeReaction = useMutation({
    mutationFn: async ({ instanceId, to, messageId }: Omit<SendReactionBody, 'emoji'>) => {
      // Remove reaction by sending empty emoji (WhatsApp pattern)
      return getClient().messages.sendReaction({ instanceId, to, messageId, emoji: '' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

  return {
    sendReaction,
    removeReaction,
  };
}
