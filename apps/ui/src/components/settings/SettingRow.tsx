import { Badge } from '@/components/ui/badge';
import type { Setting } from '@omni/sdk';

interface SettingRowProps {
  setting: Setting;
}

/**
 * Display a single setting row
 */
export function SettingRow({ setting }: SettingRowProps) {
  // Format value for display
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  // Determine badge variant based on value type
  const getBadgeVariant = (value: unknown): 'default' | 'secondary' | 'outline' => {
    if (typeof value === 'boolean') return value ? 'default' : 'secondary';
    return 'outline';
  };

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{setting.key}</p>
        {setting.description && <p className="truncate text-sm text-muted-foreground">{setting.description}</p>}
      </div>
      <Badge variant={getBadgeVariant(setting.value)} className="ml-3 shrink-0">
        {formatValue(setting.value)}
      </Badge>
    </div>
  );
}
