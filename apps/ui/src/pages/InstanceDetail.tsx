import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  useConnectInstance,
  useDeleteInstance,
  useDisconnectInstance,
  useInstance,
  useInstanceQr,
  useInstanceStatus,
  useLogoutInstance,
  useRestartInstance,
} from '@/hooks/useInstances';
import { cn, formatDateTime } from '@/lib/utils';
import { ArrowLeft, LogOut, Power, PowerOff, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

export function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: instance, isLoading } = useInstance(id!);
  const { data: status } = useInstanceStatus(id!);
  const { data: qr } = useInstanceQr(id!, status?.state === 'qr');

  const connectInstance = useConnectInstance();
  const disconnectInstance = useDisconnectInstance();
  const restartInstance = useRestartInstance();
  const logoutInstance = useLogoutInstance();
  const deleteInstance = useDeleteInstance();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <p className="text-muted-foreground">Instance not found</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/instances')}>
          Back to Instances
        </Button>
      </div>
    );
  }

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this instance? This cannot be undone.')) {
      await deleteInstance.mutateAsync(id!);
      navigate('/instances');
    }
  };

  return (
    <>
      <Header
        title={instance.name}
        subtitle={instance.channel}
        actions={
          <Button variant="ghost" onClick={() => navigate('/instances')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Status
                <Badge
                  variant={status?.isConnected ? 'success' : status?.state === 'connecting' ? 'warning' : 'secondary'}
                >
                  {status?.state ?? (instance.isActive ? 'active' : 'inactive')}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Connection</p>
                  <p className="font-medium">{status?.isConnected ? 'Connected' : 'Disconnected'}</p>
                </div>
                {status?.profileName && (
                  <div>
                    <p className="text-muted-foreground">Profile</p>
                    <p className="font-medium">{status.profileName}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{formatDateTime(instance.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Updated</p>
                  <p className="font-medium">{formatDateTime(instance.updatedAt)}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {status?.isConnected ? (
                  <Button
                    variant="outline"
                    onClick={() => disconnectInstance.mutate(id!)}
                    disabled={disconnectInstance.isPending}
                  >
                    <PowerOff className="mr-2 h-4 w-4" />
                    Disconnect
                  </Button>
                ) : (
                  <Button onClick={() => connectInstance.mutate({ id: id! })} disabled={connectInstance.isPending}>
                    <Power className="mr-2 h-4 w-4" />
                    Connect
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => restartInstance.mutate({ id: id! })}
                  disabled={restartInstance.isPending}
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', restartInstance.isPending && 'animate-spin')} />
                  Restart
                </Button>
                <Button
                  variant="outline"
                  onClick={() => logoutInstance.mutate(id!)}
                  disabled={logoutInstance.isPending}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteInstance.isPending}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* QR Code Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5" />
                QR Code
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status?.state === 'qr' && qr?.qr ? (
                <div className="space-y-4">
                  <div className="flex justify-center rounded-lg bg-white p-4">
                    <img src={qr.qr} alt="QR Code" className="h-64 w-64" />
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    Scan this QR code with WhatsApp to connect
                  </p>
                  {qr.expiresAt && (
                    <p className="text-center text-xs text-muted-foreground">
                      Expires at {formatDateTime(qr.expiresAt)}
                    </p>
                  )}
                </div>
              ) : status?.isConnected ? (
                <div className="py-12 text-center">
                  <p className="text-muted-foreground">Instance is connected</p>
                  <Button
                    className="mt-4"
                    variant="outline"
                    onClick={() => restartInstance.mutate({ id: id!, forceNewQr: true })}
                    disabled={restartInstance.isPending}
                  >
                    Generate New QR
                  </Button>
                </div>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-muted-foreground">Connect the instance to generate a QR code</p>
                  <Button
                    className="mt-4"
                    onClick={() => connectInstance.mutate({ id: id!, forceNewQr: true })}
                    disabled={connectInstance.isPending}
                  >
                    <Power className="mr-2 h-4 w-4" />
                    Connect & Show QR
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configuration Card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Instance ID</p>
                  <p className="font-mono text-sm">{instance.id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Channel</p>
                  <p className="font-medium">{instance.channel}</p>
                </div>
                {instance.agentProviderId && (
                  <div>
                    <p className="text-sm text-muted-foreground">Agent Provider</p>
                    <p className="font-mono text-sm">{instance.agentProviderId}</p>
                  </div>
                )}
                {instance.agentId && (
                  <div>
                    <p className="text-sm text-muted-foreground">Agent ID</p>
                    <p className="font-mono text-sm">{instance.agentId}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
