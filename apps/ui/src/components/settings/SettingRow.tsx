import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { useUpdateSetting } from '@/hooks/useSettings';
import { cn } from '@/lib/utils';
import type { Setting } from '@omni/sdk';
import { Check, Eye, EyeOff, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SettingRowProps {
  setting: Setting;
}

/**
 * Editable setting row - displays value with inline edit capability
 */
export function SettingRow({ setting }: SettingRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const updateSetting = useUpdateSetting();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const isSecret = setting.isSecret;
  const isMasked = isSecret && setting.value === '********';

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return 'Not set';
    if (value === '********') return '********';
    if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const getBadgeVariant = (value: unknown): 'default' | 'secondary' | 'outline' => {
    if (value === null || value === undefined || value === '') return 'secondary';
    if (typeof value === 'boolean') return value ? 'default' : 'secondary';
    if (value === '********') return 'outline';
    return 'outline';
  };

  const handleStartEdit = () => {
    // For secrets that are masked, start with empty so user types fresh
    setEditValue(isMasked ? '' : formatValue(setting.value) === 'Not set' ? '' : String(setting.value ?? ''));
    setIsEditing(true);
    setShowSecret(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setShowSecret(false);
  };

  const handleSave = async () => {
    try {
      await updateSetting.mutateAsync({ key: setting.key, value: editValue });
      toast.success(`Updated ${setting.key}`);
      setIsEditing(false);
      setEditValue('');
    } catch (error) {
      toast.error(`Failed to update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/50 p-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 truncate text-sm font-medium">{setting.key}</p>
          <div className="relative">
            <input
              ref={inputRef}
              type={isSecret && !showSecret ? 'password' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isSecret ? 'Enter new value...' : 'Enter value...'}
              className="w-full rounded-md border bg-background px-3 py-1.5 pr-10 text-sm focus:border-primary focus:outline-none"
            />
            {isSecret && (
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSave}
            disabled={updateSetting.isPending}
            className="h-8 w-8 p-0"
          >
            <Check className={cn('h-4 w-4 text-green-500', updateSetting.isPending && 'animate-pulse')} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancel}
            disabled={updateSetting.isPending}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{setting.key}</p>
        {setting.description && <p className="truncate text-sm text-muted-foreground">{setting.description}</p>}
      </div>
      <div className="ml-3 flex items-center gap-2">
        <Badge variant={getBadgeVariant(setting.value)} className="shrink-0">
          {formatValue(setting.value)}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleStartEdit}
          className="h-8 w-8 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
