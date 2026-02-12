import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useUpdateInstance } from '@/hooks/useInstances';
import { useCheckProviderHealth, useProviderAgents, useProviders } from '@/hooks/useProviders';
import { cn } from '@/lib/utils';
import type { Instance } from '@omni/sdk';
import { Bot, Check, RefreshCw, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

interface AgentConfigFormProps {
  instance: Instance;
}

/**
 * Form to configure AI agent for an instance
 */
export function AgentConfigForm({ instance }: AgentConfigFormProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(instance.agentProviderId ?? null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(instance.agentId ?? null);
  const [agentTimeout, setAgentTimeout] = useState(instance.agentTimeout ?? 60);
  const [streamMode, setStreamMode] = useState(instance.agentStreamMode ?? false);
  const [isDirty, setIsDirty] = useState(false);

  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: agents, isLoading: agentsLoading } = useProviderAgents(selectedProviderId ?? undefined);
  const updateInstance = useUpdateInstance();
  const checkHealth = useCheckProviderHealth();

  // Track if form has changes
  useEffect(() => {
    const hasChanges =
      selectedProviderId !== (instance.agentProviderId ?? null) ||
      selectedAgentId !== (instance.agentId ?? null) ||
      agentTimeout !== (instance.agentTimeout ?? 60) ||
      streamMode !== (instance.agentStreamMode ?? false);
    setIsDirty(hasChanges);
  }, [selectedProviderId, selectedAgentId, agentTimeout, streamMode, instance]);

  const handleProviderChange = (providerId: string | null) => {
    setSelectedProviderId(providerId);
    setSelectedAgentId(null); // Reset agent when provider changes
  };

  const handleSave = async () => {
    await updateInstance.mutateAsync({
      id: instance.id,
      data: {
        agentProviderId: selectedProviderId,
        agentId: selectedAgentId,
        agentTimeout,
        agentStreamMode: streamMode,
      },
    });
    setIsDirty(false);
  };

  const handleTestHealth = (providerId: string) => {
    checkHealth.mutate(providerId);
  };

  const selectedProvider = providers?.find((p) => p.id === selectedProviderId);

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5" />
            Agent Provider
          </CardTitle>
          <CardDescription>Select the AI provider that will handle incoming messages for this instance</CardDescription>
        </CardHeader>
        <CardContent>
          {providersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : !providers || providers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <Bot className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 font-medium">No providers configured</p>
              <p className="mt-1 text-sm text-muted-foreground">Add an agent provider to enable AI responses</p>
              <a href="/providers">
                <Button className="mt-4" variant="outline">
                  Configure Providers
                </Button>
              </a>
            </div>
          ) : (
            <div className="space-y-2">
              {/* None option */}
              <button
                type="button"
                onClick={() => handleProviderChange(null)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  selectedProviderId === null
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-muted-foreground/50 hover:bg-accent',
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Bot className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">No Agent</p>
                  <p className="text-sm text-muted-foreground">Messages will not be processed automatically</p>
                </div>
                {selectedProviderId === null && <Check className="h-5 w-5 text-primary" />}
              </button>

              {/* Provider options */}
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleProviderChange(provider.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    selectedProviderId === provider.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-muted-foreground/50 hover:bg-accent',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg',
                      getProviderColor(provider.schema),
                    )}
                  >
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{provider.name}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {provider.schema}
                      </Badge>
                    </div>
                  </div>
                  {selectedProviderId === provider.id && <Check className="h-5 w-5 text-primary" />}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTestHealth(provider.id);
                    }}
                    disabled={checkHealth.isPending}
                  >
                    {checkHealth.isPending && checkHealth.variables === provider.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Selection (for Agno providers) */}
      {selectedProvider?.schema === 'agno' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5" />
              Agent Selection
            </CardTitle>
            <CardDescription>Select which agent, team, or workflow should handle messages</CardDescription>
          </CardHeader>
          <CardContent>
            {agentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : !agents || agents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">No agents found for this provider</p>
              </div>
            ) : (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <button
                    key={agent.agent_id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.agent_id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      selectedAgentId === agent.agent_id
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-muted-foreground/50 hover:bg-accent',
                    )}
                  >
                    <div className="flex-1">
                      <p className="font-medium">{agent.name}</p>
                      {agent.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">{agent.description}</p>
                      )}
                    </div>
                    {selectedAgentId === agent.agent_id && <Check className="h-5 w-5 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Advanced Settings */}
      {selectedProviderId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Advanced Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="agent-timeout" className="text-sm font-medium">
                Response Timeout (seconds)
              </label>
              <Input
                id="agent-timeout"
                type="number"
                min={10}
                max={300}
                value={agentTimeout}
                onChange={(e) => setAgentTimeout(Number(e.target.value))}
                className="max-w-[120px]"
              />
              <p className="text-xs text-muted-foreground">Maximum time to wait for agent response (10-300 seconds)</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">Streaming Mode</p>
                <p className="text-sm text-muted-foreground">
                  Enable streaming responses (sends messages as they're generated)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStreamMode(!streamMode)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  streamMode ? 'bg-primary' : 'bg-muted',
                )}
              >
                <span
                  className={cn(
                    'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    streamMode && 'translate-x-5',
                  )}
                />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Button */}
      {isDirty && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateInstance.isPending}>
            {updateInstance.isPending ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Get color for provider schema badge
 */
function getProviderColor(schema: string): string {
  switch (schema) {
    case 'agno':
      return 'bg-purple-500';
    case 'webhook':
      return 'bg-blue-500';
    case 'openclaw':
      return 'bg-teal-500';
    default:
      return 'bg-gray-500';
  }
}
