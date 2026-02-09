import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePresence } from '@/hooks/usePresence';
import { useSendContact, useSendLocation, useSendPoll } from '@/hooks/useSpecialMessages';
import { cn } from '@/lib/utils';
import type { SendContactBody, SendLocationBody, SendPollBody } from '@omni/sdk';
import { BarChart3, Contact, FileText, Image, MapPin, Mic, Paperclip, Send, Smile, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ContactPicker } from './ContactPicker';
import { LocationPicker } from './LocationPicker';
import { PollCreator } from './PollCreator';

interface MessageInputProps {
  chatId: string;
  instanceId: string;
  to: string;
  channel: string;
  onSend: (text: string) => void;
  onSendMedia?: (file: File, caption?: string) => void;
  disabled?: boolean;
  error?: string | null;
  placeholder?: string;
}

// Common emojis for quick access
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '👏', '💯', '✨', '😊'];

// File type mappings for upload
const FILE_TYPES = {
  image: {
    accept: 'image/*',
    icon: Image,
    label: 'Image',
  },
  document: {
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv',
    icon: FileText,
    label: 'Document',
  },
  audio: {
    accept: 'audio/*',
    icon: Mic,
    label: 'Audio',
  },
};

/**
 * Enhanced message input with media upload and emoji picker
 */
export function MessageInput({
  chatId,
  instanceId,
  to,
  channel,
  onSend,
  onSendMedia,
  disabled,
  error,
  placeholder = 'Type a message...',
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showSpecialMenu, setShowSpecialMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  // Special message modals
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { sendTyping } = usePresence(chatId, instanceId, to);
  const sendContact = useSendContact();
  const sendLocation = useSendLocation();
  const sendPoll = useSendPoll();

  const isDiscord = channel === 'discord';

  // Send typing presence when user types
  useEffect(() => {
    if (text.length > 0) {
      sendTyping();
    }
  }, [text, sendTyping]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedFile && onSendMedia) {
      onSendMedia(selectedFile, text.trim() || undefined);
      clearFile();
      setText('');
      return;
    }

    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  const handleEmojiClick = (emoji: string) => {
    setText((prev) => prev + emoji);
    setShowEmojis(false);
    inputRef.current?.focus();
  };

  const handleFileSelect = useCallback((accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
    setShowAttachMenu(false);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFilePreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }

    // Reset the file input so the same file can be selected again
    e.target.value = '';
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
  };

  const handleSendContact = async (data: Omit<SendContactBody, 'instanceId' | 'to'>) => {
    try {
      await sendContact.mutateAsync({
        ...data,
        instanceId,
        to,
      });
      toast.success('Contact sent');
    } catch (error) {
      toast.error('Failed to send contact');
    }
  };

  const handleSendLocation = async (data: Omit<SendLocationBody, 'instanceId' | 'to'>) => {
    try {
      await sendLocation.mutateAsync({
        ...data,
        instanceId,
        to,
      });
      toast.success('Location sent');
    } catch (error) {
      toast.error('Failed to send location');
    }
  };

  const handleSendPoll = async (data: Omit<SendPollBody, 'instanceId' | 'to'>) => {
    try {
      await sendPoll.mutateAsync({
        ...data,
        instanceId,
        to,
      });
      toast.success('Poll created');
    } catch (error) {
      toast.error('Failed to create poll');
    }
  };

  return (
    <div className="border-t bg-card">
      {/* File preview */}
      {selectedFile && (
        <div className="flex items-center gap-3 border-b p-3">
          {filePreview ? (
            <img src={filePreview} alt="Preview" className="h-16 w-16 rounded-md object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={clearFile}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Input area */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3">
        {/* Hidden file input */}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

        {/* Attachment menu */}
        <TooltipProvider>
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  disabled={disabled || !onSendMedia}
                >
                  <Paperclip className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach file</TooltipContent>
            </Tooltip>

            {/* Attachment dropdown */}
            {showAttachMenu && (
              <div className="absolute bottom-full left-0 mb-2 rounded-lg border bg-popover p-2 shadow-lg">
                <div className="flex flex-col gap-1">
                  {Object.entries(FILE_TYPES).map(([key, { accept, icon: Icon, label }]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleFileSelect(accept)}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Emoji picker */}
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowEmojis(!showEmojis)}
                  disabled={disabled}
                >
                  <Smile className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Emoji</TooltipContent>
            </Tooltip>

            {/* Emoji picker dropdown */}
            {showEmojis && (
              <div className="absolute bottom-full left-0 mb-2 rounded-lg border bg-popover p-2 shadow-lg">
                <div className="grid grid-cols-6 gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleEmojiClick(emoji)}
                      className="rounded p-1.5 text-lg hover:bg-accent"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Special messages menu (contact, location, poll) */}
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSpecialMenu(!showSpecialMenu)}
                  disabled={disabled}
                >
                  <MapPin className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Special messages</TooltipContent>
            </Tooltip>

            {/* Special messages dropdown */}
            {showSpecialMenu && (
              <div className="absolute bottom-full left-0 mb-2 rounded-lg border bg-popover p-2 shadow-lg min-w-[160px]">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowContactPicker(true);
                      setShowSpecialMenu(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                  >
                    <Contact className="h-4 w-4" />
                    Contact
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLocationPicker(true);
                      setShowSpecialMenu(false);
                    }}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                  >
                    <MapPin className="h-4 w-4" />
                    Location
                  </button>
                  {isDiscord && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowPollCreator(true);
                        setShowSpecialMenu(false);
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                    >
                      <BarChart3 className="h-4 w-4" />
                      Poll
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </TooltipProvider>

        {/* Text input */}
        <Input
          ref={inputRef}
          placeholder={selectedFile ? 'Add a caption...' : placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          className="flex-1"
          onFocus={() => {
            setShowEmojis(false);
            setShowAttachMenu(false);
          }}
        />

        {/* Send button */}
        <Button
          type="submit"
          disabled={disabled || (!text.trim() && !selectedFile)}
          className={cn(text.trim() || selectedFile ? 'bg-primary' : '')}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {/* Error message */}
      {error && <p className="px-3 pb-2 text-sm text-destructive">{error}</p>}

      {/* Special message modals */}
      <ContactPicker open={showContactPicker} onClose={() => setShowContactPicker(false)} onSend={handleSendContact} />
      <LocationPicker
        open={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onSend={handleSendLocation}
      />
      <PollCreator open={showPollCreator} onClose={() => setShowPollCreator(false)} onSend={handleSendPoll} />
    </div>
  );
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
