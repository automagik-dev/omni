'use client';

/**
 * Create flow: pick a channel from the live supported-channels list, then fill a
 * channel-specific {@link SchemaForm}. On success it invalidates the instances
 * list and hands the new id back so the caller can open its detail page.
 */
import { Button, Dialog, Note, Spinner } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { requirementReason, useCan } from '../../auth';
import { SchemaForm } from '../../components/SchemaForm';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { channelLabel } from './instance-helpers';

/** Channel-specific create fields, merged over `{ name }`. */
function createSchemaFor(channel: string): z.ZodObject<z.ZodRawShape> {
  const base = { name: z.string().min(1).max(255).describe('Unique instance name') };
  switch (channel) {
    case 'discord':
      return z.object({ ...base, token: z.string().min(1).describe('Discord bot token') });
    case 'telegram':
      return z.object({ ...base, token: z.string().min(1).describe('Telegram bot token') });
    case 'slack':
      return z.object({
        ...base,
        slackBotToken: z.string().min(1).describe('Bot token'),
        slackAppToken: z.string().optional().describe('App token'),
        slackSigningSecret: z.string().optional().describe('Signing secret'),
      });
    case 'twilio-whatsapp':
      return z.object({
        ...base,
        twilioAccountSid: z.string().min(1).describe('Account SID'),
        twilioAuthToken: z.string().min(1).describe('Auth token'),
        twilioFrom: z.string().optional().describe('Sender (whatsapp:+E164)'),
      });
    case 'gupshup':
      return z.object({
        ...base,
        gupshupCallbackUrl: z.string().optional().describe('Callback URL'),
        gupshupAuthToken: z.string().optional().describe('Auth token'),
      });
    default:
      return z.object(base);
  }
}

export function CreateInstanceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { ext } = useOmniClient();
  const channels = useOmniQuery(['instances', 'supported-channels'], () => ext.instances.supportedChannels(), {
    enabled: open,
  });
  const [channel, setChannel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Creating an instance is an operational write — a read-only `member` cannot.
  const canCreate = useCan('operate');
  const createReason = requirementReason('operate');

  const reset = () => {
    setChannel(null);
    setError(null);
    setPending(false);
  };

  const submit = async (values: Record<string, unknown>) => {
    if (!channel || !canCreate) return;
    setPending(true);
    setError(null);
    try {
      const res = await ext.instances.create({ ...values, channel });
      const id = res.data?.id;
      reset();
      onClose();
      if (id) onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setPending(false);
    }
  };

  const items = channels.data?.items ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <Dialog.Title>New instance</Dialog.Title>
      <Dialog.Body>
        {!channel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, color: T.muted }}>Choose a channel:</span>
            {channels.isLoading && <Spinner size="sm" />}
            {channels.error && <Note type="error">{(channels.error as Error).message}</Note>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setChannel(ch.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surface,
                    color: T.fg,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {ch.name}
                    {!ch.loaded && (
                      <span style={{ fontSize: 11, color: T.warn, marginLeft: 8, fontWeight: 500 }}>not loaded</span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{ch.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {channel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: T.fg }}>
                Channel: <strong>{channelLabel(channel)}</strong>
              </span>
              <Button size="small" variant="secondary" onClick={() => setChannel(null)}>
                Change
              </Button>
            </div>
            {error && <Note type="error">{error}</Note>}
            {!canCreate && <Note type="warning">{createReason}</Note>}
            <SchemaForm
              schema={createSchemaFor(channel)}
              submitLabel={pending ? 'Creating…' : 'Create instance'}
              disabled={pending || !canCreate}
              onSubmit={(data) => void submit(data as Record<string, unknown>)}
            />
          </div>
        )}
      </Dialog.Body>
    </Dialog>
  );
}
