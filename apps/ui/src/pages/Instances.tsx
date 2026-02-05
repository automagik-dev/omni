import { CreateInstanceModal } from '@/components/instances/CreateInstanceModal';
import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  useConnectInstance,
  useDeleteInstance,
  useDisconnectInstance,
  useInstances,
  useRestartInstance,
} from '@/hooks/useInstances';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Plus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export function Instances() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { data, isLoading, error } = useInstances();
  const connectInstance = useConnectInstance();
  const disconnectInstance = useDisconnectInstance();
  const restartInstance = useRestartInstance();
  const deleteInstance = useDeleteInstance();

  const handleConnect = (id: string) => {
    connectInstance.mutate({ id });
  };

  const handleDisconnect = (id: string) => {
    disconnectInstance.mutate(id);
  };

  const handleRestart = (id: string) => {
    restartInstance.mutate({ id });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this instance?')) {
      deleteInstance.mutate(id);
    }
  };

  return (
    <>
      <Header
        title="Instances"
        subtitle="Manage your channel connections"
        actions={
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Instance
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">Failed to load instances</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        ) : data?.items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No instances yet</p>
              <Button className="mt-4" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first instance
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data?.items.map((instance) => (
              <Card key={instance.id} className="relative">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <Link to={`/instances/${instance.id}`} className="font-medium hover:underline">
                        {instance.name}
                      </Link>
                      <p className="text-sm text-muted-foreground">{instance.channel}</p>
                    </div>
                    <Badge variant={instance.isActive ? 'success' : 'secondary'}>
                      {instance.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  {instance.profileName && (
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">Profile:</span> {instance.profileName}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-muted-foreground">Created {formatRelativeTime(instance.createdAt)}</p>

                  {/* Actions */}
                  <div className="mt-4 flex gap-2">
                    {instance.isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnect(instance.id)}
                        disabled={disconnectInstance.isPending}
                      >
                        <PowerOff className="mr-1 h-3 w-3" />
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(instance.id)}
                        disabled={connectInstance.isPending}
                      >
                        <Power className="mr-1 h-3 w-3" />
                        Connect
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestart(instance.id)}
                      disabled={restartInstance.isPending}
                    >
                      <RefreshCw className={cn('h-3 w-3', restartInstance.isPending && 'animate-spin')} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(instance.id)}
                      disabled={deleteInstance.isPending}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateInstanceModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </>
  );
}
