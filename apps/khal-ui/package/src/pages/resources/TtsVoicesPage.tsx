'use client';

/**
 * TTS Voices — the synthesis voice catalog (GET /messages/tts/voices). Each voice
 * shows its id/name/labels, previews inline when the catalog carries a sample
 * URL, and can be set as the platform default via the `elevenlabs.default_voice`
 * setting (PUT /settings/:key, with read-back).
 */
import { Badge, Button, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, MutationResult, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { errMsg } from './shared';

interface Voice {
  [key: string]: unknown;
}

const DEFAULT_KEY = 'elevenlabs.default_voice';

function voiceId(v: Voice): string {
  return String(v.voiceId ?? v.id ?? v.voice_id ?? v.name ?? '');
}
function voiceName(v: Voice): string {
  return String(v.name ?? v.voiceName ?? v.label ?? voiceId(v));
}
function voicePreview(v: Voice): string | null {
  const url = v.previewUrl ?? v.preview_url ?? v.sampleUrl ?? v.sample;
  return typeof url === 'string' ? url : null;
}

export function TtsVoicesPage() {
  const { ext } = useOmniClient();
  const [previewOf, setPreviewOf] = useState<string | null>(null);

  const voices = useOmniQuery(['tts', 'voices'], () => ext.messages.ttsVoices());
  const currentDefault = useOmniQuery(['settings', DEFAULT_KEY], () =>
    ext.settings.get(DEFAULT_KEY).catch(() => ({ data: undefined })),
  );

  const setDefault = useOmniMutation({
    mutationFn: (id: string) => ext.settings.put(DEFAULT_KEY, id, 'khal-ui set default voice'),
    invalidate: [['settings', DEFAULT_KEY]],
    readBack: () => ext.settings.get(DEFAULT_KEY),
  });

  const list = (voices.data?.data?.voices ?? []) as Voice[];
  const defaultValue = currentDefault.data?.data?.value;

  const columns: ColumnDef<Voice>[] = [
    {
      key: 'name',
      header: 'Voice',
      render: (v) => <span style={{ fontWeight: 600, color: T.fg }}>{voiceName(v)}</span>,
    },
    { key: 'id', header: 'ID', mono: true, accessor: (v) => voiceId(v) },
    {
      key: 'default',
      header: '',
      width: 200,
      render: (v) => (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {String(defaultValue) === voiceId(v) && <Badge variant="green">default</Badge>}
          {voicePreview(v) && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => setPreviewOf(previewOf === voiceId(v) ? null : voiceId(v))}
            >
              Preview
            </Button>
          )}
          <Button size="small" variant="secondary" onClick={() => setDefault.mutate(voiceId(v))}>
            Set default
          </Button>
        </div>
      ),
    },
  ];

  const previewUrl = list.find((v) => voiceId(v) === previewOf)
    ? voicePreview(list.find((v) => voiceId(v) === previewOf) as Voice)
    : null;

  return (
    <PageShell eyebrow="Configuration" title="TTS Voices" description="Synthesis voice catalog and platform default.">
      <SectionCard padding="md">
        <span style={{ fontSize: 13, color: T.muted }}>
          Current default:{' '}
          <code style={{ fontFamily: T.mono, color: T.fg }}>{defaultValue ? String(defaultValue) : '(unset)'}</code>
        </span>
        {(setDefault.readBackData || setDefault.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'PUT', path: `/settings/${DEFAULT_KEY}` }}
              after={setDefault.readBackData?.data}
              error={errMsg(setDefault.error)}
            />
          </div>
        )}
      </SectionCard>

      {previewUrl && (
        <SectionCard padding="md">
          {/* biome-ignore lint/a11y/useMediaCaption: preview clips have no captions */}
          <audio controls src={previewUrl} style={{ width: '100%' }} />
        </SectionCard>
      )}

      <DataTable
        columns={columns}
        rows={list}
        getRowKey={(v) => voiceId(v) || voiceName(v)}
        loading={voices.isLoading}
        error={errMsg(voices.error)}
        emptyTitle="No voices"
        emptyDescription="The TTS provider returned no voice catalog."
      />

      {voices.data && list.length === 0 && (
        <Note type="default">No voices in the catalog — check the TTS provider configuration.</Note>
      )}
    </PageShell>
  );
}
