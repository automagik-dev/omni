'use client';

/**
 * TTS Voices — the synthesis voice catalog (GET /messages/tts/voices), rendered as
 * a KhalOS catalog: one hover-lift card per voice with its name, mono id, labels,
 * an inline preview when the catalog carries a sample URL, and a "set default"
 * affordance that writes `elevenlabs.default_voice` (PUT /settings/:key, read-back).
 * The endpoint is known to 500/400 on this backend; that state is surfaced
 * prominently rather than blanked.
 */
import { Badge, Button, Note, PillBadge, SectionCard, StatusDot } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { MutationResult, PageShell } from '../../components';
import { SectionHead } from '../../components/ResourceDetail';
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
/** Best-effort descriptive tags — category plus any string values under `labels`. */
function voiceLabels(v: Voice): string[] {
  const out: string[] = [];
  if (typeof v.category === 'string') out.push(v.category);
  const labels = v.labels;
  if (labels && typeof labels === 'object') {
    for (const val of Object.values(labels as Record<string, unknown>)) {
      if (typeof val === 'string' && val) out.push(val);
    }
  }
  return [...new Set(out)].slice(0, 4);
}

function VoiceCard({
  voice,
  isDefault,
  previewOpen,
  onTogglePreview,
  onSetDefault,
}: {
  voice: Voice;
  isDefault: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onSetDefault: () => void;
}) {
  const id = voiceId(voice);
  const preview = voicePreview(voice);
  const labels = voiceLabels(voice);

  return (
    <SectionCard padding="md" className="omni-card-hover">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 650,
                letterSpacing: '-0.01em',
                color: T.fg,
                wordBreak: 'break-word',
              }}
            >
              {voiceName(voice)}
            </h3>
            <span style={{ fontSize: 12, fontFamily: T.mono, color: T.tertiary, wordBreak: 'break-all' }}>{id}</span>
          </div>
          {isDefault && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <StatusDot state="active" size="sm" pulse />
              <Badge variant="green">default</Badge>
            </span>
          )}
        </div>

        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {labels.map((l) => (
              <PillBadge key={l} size="sm" variant="muted">
                {l}
              </PillBadge>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {preview && (
            <Button size="small" variant={previewOpen ? 'default' : 'secondary'} onClick={onTogglePreview}>
              {previewOpen ? 'Hide preview' : 'Preview'}
            </Button>
          )}
          <Button size="small" variant="secondary" disabled={isDefault} onClick={onSetDefault}>
            {isDefault ? 'Current default' : 'Set default'}
          </Button>
        </div>

        {previewOpen && preview && (
          // biome-ignore lint/a11y/useMediaCaption: preview clips have no captions
          <audio controls src={preview} style={{ width: '100%' }} />
        )}
      </div>
    </SectionCard>
  );
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

  return (
    <PageShell eyebrow="Configuration" title="TTS Voices" description="Synthesis voice catalog and platform default.">
      <SectionCard padding="md">
        <div style={{ marginBottom: 8 }}>
          <SectionHead>Platform default</SectionHead>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: T.muted }}>
          <span>
            Current default:{' '}
            <code style={{ fontFamily: T.mono, color: T.fg }}>{defaultValue ? String(defaultValue) : '(unset)'}</code>
          </span>
          {list.length > 0 && (
            <span style={{ fontFamily: T.mono, fontVariantNumeric: 'tabular-nums', color: T.tertiary }}>
              {list.length} voices
            </span>
          )}
        </div>
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

      {voices.error && (
        <Note type="error" label="GET /messages/tts/voices · error">
          The voice-catalog endpoint returned an error on this backend — surfaced here rather than hidden. The default
          can still be set by id above once the provider is configured.
          <span style={{ display: 'block', marginTop: 6, fontFamily: T.mono, fontSize: 12, color: T.secondary }}>
            {errMsg(voices.error)}
          </span>
        </Note>
      )}

      {voices.isLoading && <span style={{ fontSize: 12, color: T.muted }}>Loading catalog…</span>}

      {list.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {list.map((v) => {
            const id = voiceId(v);
            return (
              <VoiceCard
                key={id || voiceName(v)}
                voice={v}
                isDefault={String(defaultValue) === id}
                previewOpen={previewOf === id}
                onTogglePreview={() => setPreviewOf(previewOf === id ? null : id)}
                onSetDefault={() => setDefault.mutate(id)}
              />
            );
          })}
        </div>
      )}

      {voices.data && list.length === 0 && !voices.error && (
        <Note type="default" label="Empty catalog">
          No voices in the catalog — check the TTS provider configuration.
        </Note>
      )}
    </PageShell>
  );
}
