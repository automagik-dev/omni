import { cn } from '@/lib/utils';
import type { ExtendedMessage, MediaMetadata } from '@/types/message';
import { Download, FileText, Headphones, ImageIcon, MapPin, Play, User, Video } from 'lucide-react';

interface MediaMessageProps {
  message: ExtendedMessage;
  isFromMe: boolean;
}

/**
 * Render media content based on message type
 */
export function MediaMessage({ message, isFromMe }: MediaMessageProps) {
  const { messageType, mediaUrl, mediaMimeType, mediaMetadata, textContent } = message;

  // Handle each media type
  switch (messageType) {
    case 'image':
      return <ImageContent url={mediaUrl} caption={textContent} metadata={mediaMetadata} isFromMe={isFromMe} />;
    case 'video':
      return <VideoContent url={mediaUrl} caption={textContent} metadata={mediaMetadata} isFromMe={isFromMe} />;
    case 'audio':
      return <AudioContent url={mediaUrl} metadata={mediaMetadata} isFromMe={isFromMe} />;
    case 'document':
      return <DocumentContent url={mediaUrl} metadata={mediaMetadata} mimeType={mediaMimeType} isFromMe={isFromMe} />;
    case 'sticker':
      return <StickerContent url={mediaUrl} metadata={mediaMetadata} />;
    case 'location':
      return <LocationContent message={message} isFromMe={isFromMe} />;
    case 'contact':
      return <ContactContent message={message} isFromMe={isFromMe} />;
    default:
      return <FallbackMedia messageType={messageType} isFromMe={isFromMe} />;
  }
}

// Image message
function ImageContent({
  url,
  caption,
  metadata,
  isFromMe,
}: { url?: string | null; caption?: string | null; metadata?: MediaMetadata | null; isFromMe?: boolean }) {
  void isFromMe; // May be used for styling in future
  if (!url) {
    return (
      <div className="flex items-center gap-2 text-sm opacity-70">
        <ImageIcon className="h-4 w-4" />
        <span>Image not available</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md">
        <img
          src={url}
          alt={caption || 'Image'}
          className="max-h-80 max-w-full rounded-md object-cover"
          style={{
            maxWidth: metadata?.width ? Math.min(metadata.width, 320) : 320,
          }}
        />
        {metadata?.isGif && (
          <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white">GIF</span>
        )}
      </div>
      {caption && <p className="whitespace-pre-wrap break-words text-sm">{caption}</p>}
    </div>
  );
}

// Video message
function VideoContent({
  url,
  caption,
  metadata,
  isFromMe,
}: { url?: string | null; caption?: string | null; metadata?: MediaMetadata | null; isFromMe?: boolean }) {
  void isFromMe; // May be used for styling in future
  if (!url) {
    return (
      <div className="flex items-center gap-2 text-sm opacity-70">
        <Video className="h-4 w-4" />
        <span>Video not available</span>
      </div>
    );
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md">
        <video
          src={url}
          controls
          className="max-h-80 max-w-full rounded-md"
          style={{
            maxWidth: metadata?.width ? Math.min(metadata.width, 320) : 320,
          }}
        >
          <track kind="captions" />
        </video>
        {metadata?.duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white">
            {formatDuration(metadata.duration)}
          </span>
        )}
      </div>
      {caption && <p className="whitespace-pre-wrap break-words text-sm">{caption}</p>}
    </div>
  );
}

// Audio message (including voice notes)
function AudioContent({
  url,
  metadata,
  isFromMe,
}: { url?: string | null; metadata?: MediaMetadata | null; isFromMe: boolean }) {
  if (!url) {
    return (
      <div className="flex items-center gap-2 text-sm opacity-70">
        <Headphones className="h-4 w-4" />
        <span>Audio not available</span>
      </div>
    );
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Simple waveform visualization
  const WaveformDisplay = ({ waveform }: { waveform?: number[] }) => {
    if (!waveform || waveform.length === 0) return null;

    // Normalize and sample waveform to ~20 bars
    const samples = 20;
    const step = Math.max(1, Math.floor(waveform.length / samples));
    const normalizedWaveform = [];
    for (let i = 0; i < waveform.length && normalizedWaveform.length < samples; i += step) {
      const value = waveform[i] ?? 0;
      normalizedWaveform.push(Math.max(0.1, Math.min(1, value / 100)));
    }

    return (
      <div className="flex h-8 items-end gap-0.5">
        {normalizedWaveform.map((height, i) => (
          <div
            key={`bar-${i}-${height}`}
            className={cn('w-1 rounded-full', isFromMe ? 'bg-primary-foreground/60' : 'bg-foreground/40')}
            style={{ height: `${height * 100}%` }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex items-center gap-3">
      {metadata?.isVoiceNote ? (
        <>
          <button
            type="button"
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              isFromMe ? 'bg-primary-foreground/20' : 'bg-muted',
            )}
          >
            <Play className={cn('h-5 w-5', isFromMe ? 'text-primary-foreground' : 'text-foreground')} />
          </button>
          <div className="flex-1">
            {metadata?.waveform && <WaveformDisplay waveform={metadata.waveform} />}
            <audio src={url} controls className="mt-1 h-8 w-full">
              <track kind="captions" />
            </audio>
          </div>
          <span className={cn('text-xs', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {formatDuration(metadata?.duration)}
          </span>
        </>
      ) : (
        <audio src={url} controls className="max-w-[250px]">
          <track kind="captions" />
        </audio>
      )}
    </div>
  );
}

// Document message
function DocumentContent({
  url,
  metadata,
  mimeType,
  isFromMe,
}: { url?: string | null; metadata?: MediaMetadata | null; mimeType?: string | null; isFromMe: boolean }) {
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileName = metadata?.fileName || 'Document';
  const fileSize = formatFileSize(metadata?.fileSize);

  return (
    <div
      className={cn('flex items-center gap-3 rounded-md p-3', isFromMe ? 'bg-primary-foreground/10' : 'bg-muted/50')}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
          isFromMe ? 'bg-primary-foreground/20' : 'bg-muted',
        )}
      >
        <FileText className={cn('h-5 w-5', isFromMe ? 'text-primary-foreground' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fileName}</p>
        <p className={cn('text-xs', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {mimeType && <span>{mimeType}</span>}
          {fileSize && <span> · {fileSize}</span>}
        </p>
      </div>
      {url && (
        <a
          href={url}
          download={fileName}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
            isFromMe ? 'hover:bg-primary-foreground/20' : 'hover:bg-muted',
          )}
        >
          <Download className={cn('h-4 w-4', isFromMe ? 'text-primary-foreground' : 'text-muted-foreground')} />
        </a>
      )}
    </div>
  );
}

// Sticker message
function StickerContent({ url, metadata }: { url?: string | null; metadata?: MediaMetadata | null }) {
  if (!url) {
    return <span className="text-4xl">🎭</span>;
  }

  return (
    <img
      src={url}
      alt="Sticker"
      className="h-32 w-32 object-contain"
      style={{
        maxWidth: metadata?.width ? Math.min(metadata.width, 128) : 128,
        maxHeight: metadata?.height ? Math.min(metadata.height, 128) : 128,
      }}
    />
  );
}

// Location message
function LocationContent({ message, isFromMe }: { message: ExtendedMessage; isFromMe: boolean }) {
  // Location data might be in textContent as JSON or rawPayload
  return (
    <div
      className={cn('flex items-center gap-3 rounded-md p-3', isFromMe ? 'bg-primary-foreground/10' : 'bg-muted/50')}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
          isFromMe ? 'bg-primary-foreground/20' : 'bg-muted',
        )}
      >
        <MapPin className={cn('h-5 w-5', isFromMe ? 'text-primary-foreground' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Location</p>
        {message.textContent && (
          <p className={cn('truncate text-xs', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {message.textContent}
          </p>
        )}
      </div>
    </div>
  );
}

// Contact message
function ContactContent({ message, isFromMe }: { message: ExtendedMessage; isFromMe: boolean }) {
  return (
    <div
      className={cn('flex items-center gap-3 rounded-md p-3', isFromMe ? 'bg-primary-foreground/10' : 'bg-muted/50')}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          isFromMe ? 'bg-primary-foreground/20' : 'bg-muted',
        )}
      >
        <User className={cn('h-5 w-5', isFromMe ? 'text-primary-foreground' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Contact</p>
        {message.textContent && (
          <p className={cn('truncate text-xs', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {message.textContent}
          </p>
        )}
      </div>
    </div>
  );
}

// Fallback for unknown media types
function FallbackMedia({ messageType, isFromMe }: { messageType: string; isFromMe: boolean }) {
  return (
    <div className={cn('text-sm italic', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
      [{messageType}]
    </div>
  );
}
