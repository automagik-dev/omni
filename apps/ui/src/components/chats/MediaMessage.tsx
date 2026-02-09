import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ExtendedMessage, MediaMetadata } from '@/types/message';
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  ImageIcon,
  Mail,
  MapPin,
  Phone,
  Play,
  Save,
  User,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { PollDisplay } from './PollDisplay';

interface MediaMessageProps {
  message: ExtendedMessage;
  isFromMe: boolean;
}

/**
 * Inline processed content (transcription/description) shown below media
 */
function ProcessedContent({ message, isFromMe }: { message: ExtendedMessage; isFromMe: boolean }) {
  const text =
    message.transcription || message.imageDescription || message.videoDescription || message.documentExtraction;
  if (!text) return null;

  const label = message.transcription
    ? 'transcribed'
    : message.imageDescription
      ? 'image description'
      : message.videoDescription
        ? 'video description'
        : 'document extraction';

  return (
    <div className="mt-2 space-y-0.5">
      <p className={cn('text-xs whitespace-pre-wrap break-words', message.transcription ? '' : 'line-clamp-4')}>
        {text}
      </p>
      <span className={cn('text-[10px] italic', isFromMe ? 'text-primary-foreground/50' : 'text-muted-foreground/70')}>
        ({label})
      </span>
    </div>
  );
}

/**
 * Render media content based on message type
 */
export function MediaMessage({ message, isFromMe }: MediaMessageProps) {
  const { messageType, mediaUrl, mediaMimeType, mediaMetadata, textContent } = message;

  let mediaElement: React.ReactNode;

  // Handle each media type
  switch (messageType) {
    case 'image':
      mediaElement = (
        <ImageContent
          url={mediaUrl}
          caption={textContent}
          metadata={mediaMetadata}
          isFromMe={isFromMe}
          imageDescription={message.imageDescription}
        />
      );
      break;
    case 'video':
      mediaElement = <VideoContent url={mediaUrl} caption={textContent} metadata={mediaMetadata} isFromMe={isFromMe} />;
      break;
    case 'audio':
      mediaElement = <AudioContent url={mediaUrl} metadata={mediaMetadata} isFromMe={isFromMe} />;
      break;
    case 'document':
      mediaElement = (
        <DocumentContent url={mediaUrl} metadata={mediaMetadata} mimeType={mediaMimeType} isFromMe={isFromMe} />
      );
      break;
    case 'sticker':
      return <StickerContent url={mediaUrl} metadata={mediaMetadata} />;
    case 'poll':
      return <PollDisplay message={message} isFromMe={isFromMe} />;
    case 'location':
      return <LocationContent message={message} isFromMe={isFromMe} />;
    case 'contact':
      return <ContactContent message={message} isFromMe={isFromMe} />;
    default:
      return <FallbackMedia messageType={messageType} isFromMe={isFromMe} />;
  }

  return (
    <div>
      {mediaElement}
      <ProcessedContent message={message} isFromMe={isFromMe} />
    </div>
  );
}

// Image message
function ImageContent({
  url,
  caption,
  metadata,
  isFromMe,
  imageDescription,
}: {
  url?: string | null;
  caption?: string | null;
  metadata?: MediaMetadata | null;
  isFromMe?: boolean;
  imageDescription?: string | null;
}) {
  void isFromMe; // May be used for styling in future
  if (!url) {
    return (
      <div className="flex items-center gap-2 text-sm opacity-70">
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
        <span>Image not available</span>
      </div>
    );
  }

  // Generate descriptive alt text with fallbacks
  const altText = imageDescription || caption || 'Image attachment';

  return (
    <div className="p-2">
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-md">
          <img
            src={url}
            alt={altText}
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
    <div className="p-2">
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
    <div className="p-3">
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
    <div className="p-2">
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
    </div>
  );
}

// Sticker message
function StickerContent({ url, metadata }: { url?: string | null; metadata?: MediaMetadata | null }) {
  if (!url) {
    return (
      <span className="text-4xl" role="img" aria-label="Sticker emoji">
        🎭
      </span>
    );
  }

  // Generate descriptive label for sticker
  const stickerLabel = metadata?.fileName || 'Sticker';

  return (
    <img
      src={url}
      alt={stickerLabel}
      className="h-32 w-32 object-contain"
      style={{
        maxWidth: metadata?.width ? Math.min(metadata.width, 128) : 128,
        maxHeight: metadata?.height ? Math.min(metadata.height, 128) : 128,
      }}
    />
  );
}

// Location message with enhanced map integration
function LocationContent({ message, isFromMe }: { message: ExtendedMessage; isFromMe: boolean }) {
  // Parse location data from textContent or rawPayload
  const parseLocation = () => {
    try {
      const locationData: { lat?: number; lon?: number; name?: string; address?: string } = {};

      // Try rawPayload first (WhatsApp format)
      if (message.rawPayload) {
        const payload = typeof message.rawPayload === 'string' ? JSON.parse(message.rawPayload) : message.rawPayload;
        if (payload.latitude) locationData.lat = payload.latitude;
        if (payload.longitude) locationData.lon = payload.longitude;
        if (payload.name) locationData.name = payload.name;
        if (payload.address) locationData.address = payload.address;
      }

      // Try parsing textContent as JSON
      if (message.textContent && !locationData.lat) {
        try {
          const parsed = JSON.parse(message.textContent);
          if (parsed.latitude) locationData.lat = parsed.latitude;
          if (parsed.longitude) locationData.lon = parsed.longitude;
          if (parsed.name) locationData.name = parsed.name;
          if (parsed.address) locationData.address = parsed.address;
        } catch {
          // Not JSON, might be formatted string
          locationData.address = message.textContent;
        }
      }

      return locationData;
    } catch (error) {
      // Silently handle parse errors - fallback UI will be shown
      void error;
      return {};
    }
  };

  const location = parseLocation();
  const hasCoordinates = location.lat !== undefined && location.lon !== undefined;

  const handleOpenMaps = () => {
    if (!hasCoordinates) return;

    // Detect iOS for Apple Maps, otherwise use Google Maps
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `maps://maps.apple.com/?q=${location.lat},${location.lon}`
      : `https://www.google.com/maps?q=${location.lat},${location.lon}`;

    window.open(url, '_blank');
  };

  const handleCopyCoords = () => {
    if (!hasCoordinates) return;
    const coords = `${location.lat?.toFixed(6)}, ${location.lon?.toFixed(6)}`;
    navigator.clipboard.writeText(coords);
    toast.success('Coordinates copied to clipboard');
  };

  return (
    <div className="p-2">
      <div className={cn('rounded-md p-3 space-y-3', isFromMe ? 'bg-primary-foreground/10' : 'bg-muted/50')}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
              isFromMe ? 'bg-primary-foreground/20' : 'bg-muted',
            )}
          >
            <MapPin className={cn('h-5 w-5', isFromMe ? 'text-primary-foreground' : 'text-muted-foreground')} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{location.name || 'Location'}</p>
            {location.address && (
              <p className={cn('text-xs mt-0.5', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                {location.address}
              </p>
            )}
          </div>
        </div>

        {/* Coordinates */}
        {hasCoordinates && (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={cn(isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              {location.lat?.toFixed(6)}, {location.lon?.toFixed(6)}
            </span>
          </div>
        )}

        {/* Actions */}
        {hasCoordinates && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={handleOpenMaps}>
              <ExternalLink className="h-3 w-3 mr-1" />
              Open in Maps
            </Button>
            <Button size="sm" variant="secondary" onClick={handleCopyCoords}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Contact message with enhanced vCard parsing
function ContactContent({ message, isFromMe }: { message: ExtendedMessage; isFromMe: boolean }) {
  // Parse vCard data from textContent or rawPayload
  const parseVCard = () => {
    try {
      let vCardText = message.textContent;

      // Try rawPayload first (WhatsApp format)
      if (message.rawPayload) {
        const payload = typeof message.rawPayload === 'string' ? JSON.parse(message.rawPayload) : message.rawPayload;
        if (payload.vcard) vCardText = payload.vcard;
        if (payload.contacts?.[0]?.vcard) vCardText = payload.contacts[0].vcard;
      }

      if (!vCardText) return null;

      // Parse vCard format (simplified - handles common fields)
      const lines = vCardText.split('\n');
      const contact: { name?: string; phone?: string; email?: string; org?: string } = {};

      for (const line of lines) {
        if (line.startsWith('FN:')) contact.name = line.substring(3).trim();
        if (line.startsWith('TEL')) {
          const phoneMatch = line.match(/:([\+\d\s\-\(\)]+)/);
          if (phoneMatch) contact.phone = phoneMatch[1].trim();
        }
        if (line.startsWith('EMAIL')) {
          const emailMatch = line.match(/:([\w\.\-\+]+@[\w\.\-]+)/);
          if (emailMatch) contact.email = emailMatch[1].trim();
        }
        if (line.startsWith('ORG:')) contact.org = line.substring(4).trim();
      }

      return Object.keys(contact).length > 0 ? contact : null;
    } catch (error) {
      // Silently handle parse errors - fallback UI will be shown
      void error;
      return null;
    }
  };

  const contact = parseVCard();

  // Enhanced contact card
  if (contact) {
    const handleSave = () => {
      // Generate vCard file and trigger download
      const vCardContent = message.textContent || 'BEGIN:VCARD\nVERSION:3.0\nEND:VCARD';
      const blob = new Blob([vCardContent], { type: 'text/vcard' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${contact.name || 'contact'}.vcf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Contact saved');
    };

    return (
      <div className="p-2">
        <div className={cn('rounded-md p-3 space-y-3', isFromMe ? 'bg-primary-foreground/10' : 'bg-muted/50')}>
          {/* Header with avatar */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
                isFromMe ? 'bg-primary-foreground/20' : 'bg-muted',
              )}
            >
              <User className={cn('h-6 w-6', isFromMe ? 'text-primary-foreground' : 'text-muted-foreground')} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">{contact.name || 'Unknown Contact'}</p>
              {contact.org && (
                <p className={cn('text-xs', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  {contact.org}
                </p>
              )}
            </div>
          </div>

          {/* Contact details */}
          <div className="space-y-2">
            {contact.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className={cn('h-4 w-4', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')} />
                <span>{contact.phone}</span>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className={cn('h-4 w-4', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')} />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {contact.phone && (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => window.open(`tel:${contact.phone}`, '_self')}
              >
                <Phone className="h-3 w-3 mr-1" />
                Call
              </Button>
            )}
            <Button size="sm" variant="secondary" className="flex-1" onClick={handleSave}>
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Fallback to simple display
  return (
    <div className="p-2">
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
