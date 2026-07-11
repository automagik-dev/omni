'use client';

/**
 * Media Console — the six generative media endpoints (tts / stt / imagine /
 * vision / film / music). Every one calls a PAID external provider, so each panel
 * generates only behind a LIVE cost-warning confirm and is NEVER exercised by
 * automated validation. Returned media (audio/image/video base64) renders inline.
 */
import { Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import type { MediaResult } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog, JsonInspector, MutationResult, PageShell, SchemaForm } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation } from '../../hooks/useOmniQuery';
import { errMsg } from './shared';

function MediaOutput({ data }: { data: MediaResult }) {
  const d = data as Record<string, unknown>;
  const audio = d.audioBase64 as string | undefined;
  const video = d.videoBase64 as string | undefined;
  const images = d.images as Array<Record<string, unknown>> | undefined;
  const text = d.text as string | undefined;
  const mime = (d.mimeType as string | undefined) ?? 'application/octet-stream';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {audio && (
        // biome-ignore lint/a11y/useMediaCaption: generated clips have no captions
        <audio controls src={`data:${mime};base64,${audio}`} style={{ width: '100%' }} />
      )}
      {video && (
        // biome-ignore lint/a11y/useMediaCaption: generated clips have no captions
        <video controls src={`data:${mime};base64,${video}`} style={{ maxWidth: '100%', borderRadius: 8 }} />
      )}
      {images?.map((img) => {
        const b64 = img.base64 as string;
        return (
          <img
            key={b64.slice(0, 24)}
            alt="generated"
            src={`data:${(img.mimeType as string) ?? 'image/png'};base64,${b64}`}
            style={{ maxWidth: '100%', borderRadius: 8 }}
          />
        );
      })}
      {text && <p style={{ margin: 0, fontSize: 13, color: T.fg, whiteSpace: 'pre-wrap' }}>{text}</p>}
      <JsonInspector
        value={{ ...d, audioBase64: audio ? '[omitted]' : undefined, videoBase64: video ? '[omitted]' : undefined }}
      />
    </div>
  );
}

interface PanelDef {
  id: string;
  title: string;
  schema: z.ZodType<Record<string, unknown>>;
  run: (ext: ReturnType<typeof useOmniClient>['ext'], body: Record<string, unknown>) => Promise<{ data?: MediaResult }>;
}

function MediaPanel({ def }: { def: PanelDef }) {
  const { ext } = useOmniClient();
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const mut = useOmniMutation({ mutationFn: (body: Record<string, unknown>) => def.run(ext, body) });

  return (
    <SectionCard padding="md">
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: T.fg }}>{def.title}</h3>
      <Note type="warning" label="LIVE · costs money">
        Calls a paid external provider. Confirm required — this panel is never auto-run by validation.
      </Note>
      <div style={{ marginTop: 12 }}>
        <SchemaForm
          schema={def.schema}
          submitLabel="Generate (LIVE $)"
          onSubmit={(data) => {
            setPending(data as Record<string, unknown>);
            setConfirm(true);
          }}
        />
      </div>
      {mut.error && (
        <div style={{ marginTop: 12 }}>
          <MutationResult
            effect="live"
            request={{ method: 'POST', path: `/media/${def.id}` }}
            error={errMsg(mut.error)}
          />
        </div>
      )}
      {mut.data?.data && (
        <div style={{ marginTop: 12 }}>
          <MediaOutput data={mut.data.data} />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (pending) mut.mutate(pending);
          setConfirm(false);
        }}
        title={`Generate — ${def.title}`}
        targetName={def.title}
        targetId={`/media/${def.id}`}
        effect="live"
        destructive
        confirmLabel="Generate (charges apply)"
        description="This calls a paid external provider and will incur cost."
      />
    </SectionCard>
  );
}

const PANELS: PanelDef[] = [
  {
    id: 'tts',
    title: 'Text-to-speech',
    schema: z.object({
      text: z.string().describe('Text to speak'),
      voice: z.string().optional(),
      format: z.enum(['mp3', 'ogg', 'opus', 'wav']).optional(),
    }),
    run: (ext, body) => ext.media.tts(body),
  },
  {
    id: 'stt',
    title: 'Speech-to-text',
    schema: z.object({
      audioBase64: z.string().describe('Base64 audio'),
      mimeType: z.string().describe('e.g. audio/ogg'),
      language: z.string().optional(),
    }),
    run: (ext, body) => ext.media.stt(body),
  },
  {
    id: 'imagine',
    title: 'Image generation',
    schema: z.object({
      prompt: z.string().describe('Image prompt'),
      count: z.number().optional().describe('1–4'),
      aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
    }),
    run: (ext, body) => ext.media.imagine(body),
  },
  {
    id: 'vision',
    title: 'Vision (describe media)',
    schema: z.object({
      mediaBase64: z.string().describe('Base64 image'),
      mimeType: z.string().describe('e.g. image/png'),
      prompt: z.string().optional(),
    }),
    run: (ext, body) => ext.media.vision(body),
  },
  {
    id: 'film',
    title: 'Video generation',
    schema: z.object({
      prompt: z.string().describe('Video prompt'),
      durationSec: z.number().optional().describe('1–60'),
    }),
    run: (ext, body) => ext.media.film(body),
  },
  {
    id: 'music',
    title: 'Music generation',
    schema: z.object({
      prompt: z.string().describe('Music prompt'),
      instrumental: z.boolean().optional(),
      durationSec: z.number().optional(),
    }),
    run: (ext, body) => ext.media.music(body),
  },
];

export function MediaConsolePage() {
  return (
    <PageShell
      eyebrow="Configuration"
      title="Media Console"
      description="Generative media endpoints — every panel calls a paid provider behind a confirm."
    >
      {PANELS.map((def) => (
        <MediaPanel key={def.id} def={def} />
      ))}
    </PageShell>
  );
}
