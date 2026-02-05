import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/query';
import { getApiKey, getClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Key, RefreshCw, Server, Settings as SettingsIcon } from 'lucide-react';

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

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: queryKeys.settingsList(),
    queryFn: () => getClient().settings.list(),
  });

  const apiKey = getApiKey();
  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}${'*'.repeat(20)}` : '';

  return (
    <>
      <Header title="Settings" subtitle="System configuration" />

      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-6">
          {/* API Key Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Key
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isValidating ? (
                <Spinner size="sm" />
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

          {/* System Health */}
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
                <Spinner size="sm" />
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
                <p className="text-muted-foreground">Unable to fetch health status</p>
              )}
            </CardContent>
          </Card>

          {/* System Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5" />
                System Settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingSettings ? (
                <Spinner size="sm" />
              ) : settings && settings.length > 0 ? (
                <div className="space-y-4">
                  {settings.map((setting) => (
                    <div key={setting.key} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="font-medium">{setting.key}</p>
                        {setting.description && <p className="text-sm text-muted-foreground">{setting.description}</p>}
                      </div>
                      <Badge variant="outline">{String(setting.value)}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No settings configured</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
