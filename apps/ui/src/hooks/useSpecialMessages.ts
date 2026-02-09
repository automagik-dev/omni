import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { SendContactBody, SendLocationBody, SendPollBody } from '@omni/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Hook for sending contact cards
 */
export function useSendContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendContactBody) => {
      return getClient().messages.sendContact(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

/**
 * Hook for sending location
 */
export function useSendLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendLocationBody) => {
      return getClient().messages.sendLocation(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

/**
 * Hook for sending polls (Discord only)
 */
export function useSendPoll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendPollBody) => {
      return getClient().messages.sendPoll(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}
