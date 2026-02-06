import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import {
  useConnectInstance,
  useCreateInstance,
  useInstanceQr,
  useInstanceStatus,
  usePairInstance,
} from '@/hooks/useInstances';
import { cn } from '@/lib/utils';
import type { Channel, Instance } from '@omni/sdk';
import { ArrowLeft, ArrowRight, Check, Phone, QrCode, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';

// Discord icon component
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="discordIconTitle">
      <title id="discordIconTitle">Discord</title>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  );
}

// WhatsApp icon component
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="whatsappIconTitle">
      <title id="whatsappIconTitle">WhatsApp</title>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

interface CreateInstanceModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (instance: Instance) => void;
}

// Channel options with descriptions
const CHANNEL_OPTIONS: {
  value: Channel;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  disabled?: boolean;
}[] = [
  {
    value: 'whatsapp-baileys',
    label: 'WhatsApp',
    description: 'Connect via QR code or pairing code. Free, no Meta verification required.',
    icon: WhatsAppIcon,
    color: 'bg-green-500',
  },
  {
    value: 'whatsapp-cloud',
    label: 'WhatsApp Cloud API',
    description: 'Official Meta API. Requires business verification.',
    icon: WhatsAppIcon,
    color: 'bg-green-600',
    disabled: true, // TODO: Implement later
  },
  {
    value: 'discord',
    label: 'Discord',
    description: 'Connect a Discord bot. Requires bot token.',
    icon: DiscordIcon,
    color: 'bg-indigo-500',
  },
];

type Step = 'channel' | 'details' | 'connect';

export function CreateInstanceModal({ open, onClose, onSuccess }: CreateInstanceModalProps) {
  const [step, setStep] = useState<Step>('channel');
  const [channel, setChannel] = useState<Channel>('whatsapp-baileys');
  const [name, setName] = useState('');
  const [createdInstance, setCreatedInstance] = useState<Instance | null>(null);
  const [connectionMethod, setConnectionMethod] = useState<'qr' | 'pairing'>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');

  const createInstance = useCreateInstance();
  const connectInstance = useConnectInstance();
  const pairInstance = usePairInstance();
  const { data: status } = useInstanceStatus(createdInstance?.id ?? '', !!createdInstance);
  const { data: qr } = useInstanceQr(createdInstance?.id ?? '', status?.state === 'qr');

  if (!open) return null;

  const handleChannelSelect = (selectedChannel: Channel) => {
    setChannel(selectedChannel);
    setStep('details');
  };

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      const instance = await createInstance.mutateAsync({
        name: name.trim(),
        channel,
      });
      setCreatedInstance(instance);

      // For WhatsApp, go to connect step
      if (channel.startsWith('whatsapp')) {
        setStep('connect');
        // Auto-start connection
        await connectInstance.mutateAsync({ id: instance.id });
      } else {
        // For other channels, we're done
        onSuccess?.(instance);
        handleReset();
      }
    } catch {
      // Error handled by mutation
    }
  };

  const handlePair = async () => {
    if (!createdInstance || !phoneNumber.trim()) return;

    try {
      await pairInstance.mutateAsync({
        id: createdInstance.id,
        phoneNumber: phoneNumber.trim(),
      });
    } catch {
      // Error handled by mutation
    }
  };

  const handleComplete = () => {
    if (createdInstance) {
      onSuccess?.(createdInstance);
    }
    handleReset();
  };

  const handleReset = () => {
    setStep('channel');
    setChannel('whatsapp-baileys');
    setName('');
    setCreatedInstance(null);
    setConnectionMethod('qr');
    setPhoneNumber('');
    onClose();
  };

  const getProgress = () => {
    switch (step) {
      case 'channel':
        return 33;
      case 'details':
        return 66;
      case 'connect':
        return status?.isConnected ? 100 : 85;
      default:
        return 0;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg">
        <CardHeader className="relative">
          <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={handleReset}>
            <X className="h-4 w-4" />
          </Button>
          <CardTitle>Create Instance</CardTitle>
          <CardDescription>
            {step === 'channel' && 'Select a messaging platform to connect'}
            {step === 'details' && 'Configure your new instance'}
            {step === 'connect' && 'Connect your account'}
          </CardDescription>
          <Progress value={getProgress()} className="mt-4" />
        </CardHeader>
        <CardContent>
          {/* Step 1: Channel Selection */}
          {step === 'channel' && (
            <div className="space-y-3">
              {CHANNEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => !option.disabled && handleChannelSelect(option.value)}
                  disabled={option.disabled}
                  className={cn(
                    'flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                    option.disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-primary hover:bg-accent',
                  )}
                >
                  <div className={cn('flex h-12 w-12 items-center justify-center rounded-lg', option.color)}>
                    <option.icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{option.label}</p>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                    {option.disabled && <p className="mt-1 text-xs text-orange-500">Coming soon</p>}
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Instance Details */}
          {step === 'details' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="instance-name" className="text-sm font-medium">
                  Instance Name
                </label>
                <Input
                  id="instance-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={channel === 'discord' ? 'My Discord Bot' : 'My WhatsApp'}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">A friendly name to identify this connection</p>
              </div>

              {/* Channel-specific config could go here */}
              {channel === 'discord' && (
                <div className="space-y-2">
                  <label htmlFor="bot-token" className="text-sm font-medium">
                    Bot Token
                  </label>
                  <Input id="bot-token" type="password" placeholder="Enter your Discord bot token" />
                  <p className="text-xs text-muted-foreground">Get this from the Discord Developer Portal</p>
                </div>
              )}

              {createInstance.error && (
                <p className="text-sm text-destructive">
                  {createInstance.error instanceof Error ? createInstance.error.message : 'Failed to create instance'}
                </p>
              )}

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep('channel')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button onClick={handleCreate} disabled={createInstance.isPending || !name.trim()}>
                  {createInstance.isPending ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      Create
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Connect (WhatsApp) */}
          {step === 'connect' && createdInstance && (
            <div className="space-y-4">
              {status?.isConnected ? (
                // Connected successfully
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                    <Check className="h-8 w-8 text-green-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Connected Successfully!</h3>
                    <p className="text-sm text-muted-foreground">
                      {status.profileName && `Logged in as ${status.profileName}`}
                    </p>
                  </div>
                  <Button onClick={handleComplete} className="w-full">
                    Done
                  </Button>
                </div>
              ) : (
                // Connection options
                <>
                  {/* Method toggle */}
                  <div className="flex gap-2 rounded-lg border p-1">
                    <button
                      type="button"
                      onClick={() => setConnectionMethod('qr')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                        connectionMethod === 'qr' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                      )}
                    >
                      <QrCode className="h-4 w-4" />
                      QR Code
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectionMethod('pairing')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                        connectionMethod === 'pairing' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                      )}
                    >
                      <Phone className="h-4 w-4" />
                      Pairing Code
                    </button>
                  </div>

                  {connectionMethod === 'qr' ? (
                    // QR Code method
                    <div className="space-y-4">
                      {status?.state === 'qr' && qr?.qr ? (
                        <div className="flex flex-col items-center space-y-4">
                          <div className="rounded-lg bg-white p-4">
                            <QRCodeSVG value={qr.qr} size={224} level="M" />
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-medium">Scan with WhatsApp</p>
                            <p className="text-xs text-muted-foreground">
                              Open WhatsApp → Settings → Linked Devices → Link a Device
                            </p>
                          </div>
                          {qr.expiresAt && (
                            <QRCountdown
                              expiresAt={qr.expiresAt}
                              onExpired={() => {
                                // Trigger reconnect for new QR
                                connectInstance.mutate({ id: createdInstance.id, forceNewQr: true });
                              }}
                            />
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center py-8">
                          <Spinner size="lg" />
                          <p className="mt-4 text-sm text-muted-foreground">
                            {status?.state === 'connecting' ? 'Connecting...' : 'Generating QR code...'}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Pairing Code method
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="phone-number" className="text-sm font-medium">
                          Phone Number
                        </label>
                        <Input
                          id="phone-number"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="+1234567890"
                        />
                        <p className="text-xs text-muted-foreground">Enter the phone number registered with WhatsApp</p>
                      </div>

                      {pairInstance.error && (
                        <p className="text-sm text-destructive">
                          {pairInstance.error instanceof Error
                            ? pairInstance.error.message
                            : 'Failed to generate pairing code'}
                        </p>
                      )}

                      {pairInstance.data?.code ? (
                        <div className="rounded-lg border bg-muted/50 p-4 text-center">
                          <p className="text-sm text-muted-foreground">Your pairing code is:</p>
                          <p className="mt-2 font-mono text-3xl font-bold tracking-wider">{pairInstance.data.code}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Enter this code in WhatsApp → Linked Devices → Link with phone number
                          </p>
                        </div>
                      ) : (
                        <Button
                          onClick={handlePair}
                          disabled={pairInstance.isPending || !phoneNumber.trim()}
                          className="w-full"
                        >
                          {pairInstance.isPending ? (
                            <>
                              <Spinner size="sm" className="mr-2" />
                              Generating...
                            </>
                          ) : (
                            'Get Pairing Code'
                          )}
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between border-t pt-4">
                    <Button variant="outline" onClick={handleReset}>
                      Cancel
                    </Button>
                    <Button variant="outline" onClick={handleComplete}>
                      Skip for now
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * QR Code countdown timer
 */
function QRCountdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [timeLeft, setTimeLeft] = useState(() => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  });

  // Update countdown
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      const seconds = Math.max(0, Math.floor(diff / 1000));
      setTimeLeft(seconds);

      if (seconds <= 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  if (timeLeft <= 0) {
    return <p className="text-sm text-orange-500">QR code expired. Generating new one...</p>;
  }

  return (
    <p className="text-xs text-muted-foreground">
      Expires in {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
    </p>
  );
}
