import { Header } from '@/components/layout';
import { SettingRow } from '@/components/settings';
import type { SettingOption } from '@/components/settings/SettingRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useGroupedSettings } from '@/hooks/useSettings';
import { useVoices } from '@/hooks/useVoices';
import { queryKeys } from '@/lib/query';
import { getApiKey, getClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Key, RefreshCw, Server, Settings as SettingsIcon, Sliders } from 'lucide-react';
import { useMemo } from 'react';

/**
 * Skeleton for settings list
 */
function SettingsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Format category name for display
 */
function formatCategoryName(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
}

export function Settings() {
  const { keyInfo, isValidating } = useAuth();

  const {
    data: health,
    isLoading: loadingHealth,
    refetch: refetchHealth,
    isRefetching,
  } = useQuery({
    queryKey: queryKeys.systemHealth(),
    queryFn: () => getClient().system.health(),
  });

  const { grouped, categories, isLoading: loadingSettings } = useGroupedSettings();
  const { data: voices } = useVoices();

  const voiceOptions = useMemo<SettingOption[]>(
    () => voices?.map((v) => ({ value: v.voiceId, label: `${v.name} (${v.category})` })) ?? [],
    [voices],
  );

  const modelOptions: SettingOption[] = [
    { value: 'eleven_v3', label: 'Eleven v3 (Latest)' },
    { value: 'eleven_multilingual_v2', label: 'Eleven Multilingual v2' },
    { value: 'eleven_monolingual_v1', label: 'Eleven Monolingual v1' },
    { value: 'eleven_turbo_v2_5', label: 'Eleven Turbo v2.5' },
    { value: 'eleven_turbo_v2', label: 'Eleven Turbo v2' },
  ];

  const optionsForKey = (key: string): SettingOption[] | undefined => {
    if (key === 'elevenlabs.default_voice') return voiceOptions;
    if (key === 'elevenlabs.default_model') return modelOptions;
    return undefined;
  };

  const apiKey = getApiKey();
  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}${'*'.repeat(20)}` : '';

  return (
    <>
      <Header title="Settings" subtitle="System configuration and health monitoring" />

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">
              <SettingsIcon className="mr-2 h-4 w-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="system">
              <Server className="mr-2 h-4 w-4" />
              System
            </TabsTrigger>
            <TabsTrigger value="configuration">
              <Sliders className="mr-2 h-4 w-4" />
              Configuration
            </TabsTrigger>
          </TabsList>

          {/* General Tab - API Key Info */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  API Key
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isValidating ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-4 w-48" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Key</p>
                      <p className="font-mono text-sm">{maskedKey}</p>
                    </div>
                    {keyInfo && (
                      <>
                        <div>
                          <p className="text-sm text-muted-foreground">Name</p>
                          <p className="font-medium">{keyInfo.name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Prefix</p>
                          <p className="font-mono text-sm">{keyInfo.prefix}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Scopes</p>
                          <div className="flex flex-wrap gap-1">
                            {keyInfo.scopes.map((scope) => (
                              <Badge key={scope} variant="secondary">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* System Tab - Health */}
          <TabsContent value="system" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    System Health
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => refetchHealth()} disabled={isRefetching}>
                    <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingHealth ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                ) : health ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">Status:</p>
                      <Badge variant={health.status === 'healthy' ? 'success' : 'destructive'}>{health.status}</Badge>
                    </div>
                    {health.version && (
                      <div>
                        <p className="text-sm text-muted-foreground">Version</p>
                        <p className="font-mono text-sm">{health.version}</p>
                      </div>
                    )}
                    {health.checks && (
                      <div>
                        <p className="mb-2 text-sm text-muted-foreground">Health Checks</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.entries(health.checks as Record<string, { status: string }>).map(([name, check]) => (
                            <div key={name} className="flex items-center justify-between rounded-md border p-2">
                              <span className="text-sm">{name}</span>
                              <Badge variant={check.status === 'healthy' ? 'success' : 'destructive'}>
                                {check.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <Server className="mx-auto h-12 w-12 text-muted-foreground/50" />
                    <p className="mt-4 text-muted-foreground">Unable to fetch health status</p>
                    <Button variant="outline" className="mt-4" onClick={() => refetchHealth()}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Retry
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Configuration Tab - Settings by Category */}
          <TabsContent value="configuration" className="space-y-6">
            {loadingSettings ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sliders className="h-5 w-5" />
                    System Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SettingsSkeleton />
                </CardContent>
              </Card>
            ) : categories.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sliders className="h-5 w-5" />
                    System Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="py-8 text-center">
                    <SettingsIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
                    <p className="mt-4 text-muted-foreground">No settings configured</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      System settings will appear here once configured via the CLI or API.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              categories.map((category) => (
                <Card key={category}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sliders className="h-5 w-5" />
                      {formatCategoryName(category)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {grouped[category].map((setting) => (
                        <SettingRow key={setting.key} setting={setting} options={optionsForKey(setting.key)} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
