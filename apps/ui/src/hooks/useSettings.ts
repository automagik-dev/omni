import { queryKeys } from '@/lib/query';
import { apiFetch, getClient } from '@/lib/sdk';
import type { ListSettingsParams, Setting } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * Fetch settings list
 */
export function useSettings(params?: ListSettingsParams) {
  return useQuery({
    queryKey: queryKeys.settingsList(params ? { category: params.category } : undefined),
    queryFn: () => getClient().settings.list(params),
  });
}

/**
 * Group settings by category
 */
export function useGroupedSettings(params?: ListSettingsParams) {
  const query = useSettings(params);

  const grouped = useMemo(() => {
    if (!query.data) return {};

    return query.data.reduce<Record<string, Setting[]>>((acc, setting) => {
      // Extract category from key (e.g., "agent.default_provider" -> "agent")
      const category = setting.key.split('.')[0] ?? 'general';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(setting);
      return acc;
    }, {});
  }, [query.data]);

  return {
    ...query,
    grouped,
    categories: Object.keys(grouped).sort(),
  };
}

/**
 * Update a single setting by key
 */
export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const response = await apiFetch(`/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((err as { error?: string }).error ?? `Failed to update setting: ${response.status}`);
      }
      return (await response.json()) as { data: Setting };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

/**
 * Bulk update multiple settings
 */
export function useBulkUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ settings, reason }: { settings: Record<string, unknown>; reason?: string }) => {
      const response = await apiFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings, reason }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((err as { error?: string }).error ?? `Failed to update settings: ${response.status}`);
      }
      return (await response.json()) as { items: Setting[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}
