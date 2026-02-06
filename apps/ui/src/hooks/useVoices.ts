import { queryKeys } from '@/lib/query';
import { apiFetch } from '@/lib/sdk';
import { useQuery } from '@tanstack/react-query';

/** Voice info from ElevenLabs */
export interface Voice {
  voiceId: string;
  name: string;
  category: string;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

/**
 * Fetch available TTS voices from ElevenLabs (via API)
 */
export function useVoices() {
  return useQuery({
    queryKey: queryKeys.ttsVoices,
    queryFn: async (): Promise<Voice[]> => {
      const response = await apiFetch('/messages/tts/voices');
      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          // No API key configured - return empty
          return [];
        }
        throw new Error(`Failed to fetch voices: ${response.status}`);
      }
      const json = (await response.json()) as { data: { voices: Voice[] } };
      return json.data.voices;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (matches server-side cache)
  });
}
