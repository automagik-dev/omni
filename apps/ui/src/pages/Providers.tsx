import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCheckProviderHealth, useCreateProvider, useDeleteProvider, useProviders } from '@/hooks/useProviders';
import { cn } from '@/lib/utils';
import { AlertTriangle, Bot, Check, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import { useState } from 'react';

// Provider schema options
const SCHEMA_OPTIONS = [
  {
    value: 'agno',
    label: 'Agno',
    description: 'Agno AI orchestration platform',
    color: 'bg-purple-500',
  },
  {
    value: 'webhook',
    label: 'Webhook',
    description: 'Custom webhook-based provider',
    color: 'bg-blue-500',
  },
  {
    value: 'openclaw',
    label: 'OpenClaw',
    description: 'OpenClaw WebSocket gateway',
    color: 'bg-teal-500',
  },
];

export function Providers() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { data: providers, isLoading } = useProviders();
  const deleteProvider = useDeleteProvider();
  const checkHealth = useCheckProviderHealth();

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      await deleteProvider.mutateAsync(id);
    }
  };

  return (
    <>
      <Header
        title="Agent Providers"
        subtitle="Configure AI providers for automated message handling"
        actions={
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Provider
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : !providers || providers.length === 0 ? (
          <Card className="mx-auto max-w-md">
            <CardContent className="flex flex-col items-center py-12">
              <Bot className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Providers Configured</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Add an agent provider to enable AI-powered message handling for your instances.
              </p>
              <Button className="mt-6" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Provider
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => {
              const schemaConfig = SCHEMA_OPTIONS.find((s) => s.value === provider.schema) || SCHEMA_OPTIONS[4];
              const healthResult = checkHealth.data;
              const isHealthy =
                healthResult && checkHealth.variables === provider.id
                  ? (healthResult as { healthy?: boolean }).healthy
                  : undefined;

              return (
                <Card key={provider.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn('flex h-10 w-10 items-center justify-center rounded-lg', schemaConfig.color)}
                        >
                          <Bot className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{provider.name}</CardTitle>
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            {schemaConfig.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      <p className="truncate">
                        <span className="font-medium">Base URL:</span> {provider.baseUrl || 'Default'}
                      </p>
                    </div>

                    {/* Health status */}
                    {isHealthy !== undefined && (
                      <div
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1 text-xs',
                          isHealthy ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600',
                        )}
                      >
                        {isHealthy ? (
                          <>
                            <Check className="h-3 w-3" />
                            Healthy
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-3 w-3" />
                            Unhealthy
                          </>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => checkHealth.mutate(provider.id)}
                        disabled={checkHealth.isPending && checkHealth.variables === provider.id}
                      >
                        {checkHealth.isPending && checkHealth.variables === provider.id ? (
                          <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Zap className="mr-2 h-3 w-3" />
                        )}
                        Test
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(provider.id, provider.name)}
                        disabled={deleteProvider.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Provider Modal */}
      {showCreateModal && <CreateProviderModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />}
    </>
  );
}

/**
 * Modal for creating a new provider
 */
function CreateProviderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<'schema' | 'details'>('schema');
  const [schema, setSchema] = useState<string>('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const createProvider = useCreateProvider();

  if (!open) return null;

  const handleSchemaSelect = (selectedSchema: string) => {
    setSchema(selectedSchema);
    setStep('details');
  };

  const handleCreate = async () => {
    if (!name.trim() || !schema) return;

    try {
      await createProvider.mutateAsync({
        name: name.trim(),
        schema: schema as 'agno' | 'webhook' | 'openclaw' | 'ag-ui' | 'claude-code',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      handleReset();
    } catch {
      // Error handled by mutation
    }
  };

  const handleReset = () => {
    setStep('schema');
    setSchema('');
    setName('');
    setBaseUrl('');
    setApiKey('');
    onClose();
  };

  const selectedSchemaConfig = SCHEMA_OPTIONS.find((s) => s.value === schema);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg">
        <CardHeader className="relative">
          <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={handleReset}>
            <X className="h-4 w-4" />
          </Button>
          <CardTitle>Add Provider</CardTitle>
          <CardDescription>
            {step === 'schema' && 'Select the type of AI provider'}
            {step === 'details' && 'Configure your provider settings'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'schema' && (
            <div className="space-y-3">
              {SCHEMA_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSchemaSelect(option.value)}
                  className="flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', option.color)}>
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{option.label}</p>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'details' && selectedSchemaConfig && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                <div
                  className={cn('flex h-10 w-10 items-center justify-center rounded-lg', selectedSchemaConfig.color)}
                >
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-medium">{selectedSchemaConfig.label}</p>
                  <p className="text-xs text-muted-foreground">{selectedSchemaConfig.description}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="provider-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="provider-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`My ${selectedSchemaConfig.label} Provider`}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="base-url" className="text-sm font-medium">
                  Base URL <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={
                    schema === 'openai'
                      ? 'https://api.openai.com/v1'
                      : schema === 'anthropic'
                        ? 'https://api.anthropic.com'
                        : 'https://...'
                  }
                />
                <p className="text-xs text-muted-foreground">Leave empty to use the default endpoint</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="api-key" className="text-sm font-medium">
                  API Key
                </label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>

              {createProvider.error && (
                <p className="text-sm text-destructive">
                  {createProvider.error instanceof Error ? createProvider.error.message : 'Failed to create provider'}
                </p>
              )}

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep('schema')}>
                  Back
                </Button>
                <Button onClick={handleCreate} disabled={createProvider.isPending || !name.trim()}>
                  {createProvider.isPending ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Creating...
                    </>
                  ) : (
                    'Create Provider'
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
