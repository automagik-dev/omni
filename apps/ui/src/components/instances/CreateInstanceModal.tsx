import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCreateInstance } from '@/hooks/useInstances';
import type { Channel } from '@omni/sdk';
import { useState } from 'react';

interface CreateInstanceModalProps {
  open: boolean;
  onClose: () => void;
}

const channels: { value: Channel; label: string }[] = [
  { value: 'whatsapp-baileys', label: 'WhatsApp (Baileys)' },
  { value: 'whatsapp-cloud', label: 'WhatsApp Cloud API' },
  { value: 'discord', label: 'Discord' },
];

export function CreateInstanceModal({ open, onClose }: CreateInstanceModalProps) {
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel>('whatsapp-baileys');
  const createInstance = useCreateInstance();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await createInstance.mutateAsync({ name: name.trim(), channel });
      setName('');
      setChannel('whatsapp-baileys');
      onClose();
    } catch {
      // Error is handled by the mutation
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create Instance</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="instance-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="instance-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My WhatsApp"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="instance-channel" className="text-sm font-medium">
                Channel
              </label>
              <select
                id="instance-channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {channels.map((ch) => (
                  <option key={ch.value} value={ch.value}>
                    {ch.label}
                  </option>
                ))}
              </select>
            </div>

            {createInstance.error && (
              <p className="text-sm text-destructive">
                {createInstance.error instanceof Error ? createInstance.error.message : 'Failed to create instance'}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={createInstance.isPending || !name.trim()}>
                {createInstance.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
