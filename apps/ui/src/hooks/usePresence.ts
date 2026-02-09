import { getClient } from '@/lib/sdk';
import { useMutation } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';

/**
 * Hook for managing presence indicators (typing, online, etc.)
 */
export function usePresence(_chatId: string, instanceId: string, to: string) {
  const sendTyping = useMutation({
    mutationFn: async () => {
      return getClient().messages.sendPresence({
        instanceId,
        to,
        type: 'typing',
        duration: 5000, // 5 seconds
      });
    },
  });

  // Debounce typing notifications (send max every 3 seconds)
  const debouncedSendTyping = useDebouncedCallback(
    () => {
      sendTyping.mutate();
    },
    3000,
    { leading: true, trailing: false },
  );

  return {
    sendTyping: debouncedSendTyping,
  };
}
