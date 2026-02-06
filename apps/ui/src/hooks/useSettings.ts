import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ListSettingsParams, Setting } from '@omni/sdk';
import { useQuery } from '@tanstack/react-query';
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
