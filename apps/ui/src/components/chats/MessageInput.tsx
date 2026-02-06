import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FileText, Image, MapPin, Mic, Paperclip, Send, Smile, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

interface MessageInputProps {
  onSend: (text: string) => void;
  onSendMedia?: (file: File, caption?: string) => void;
  onSendLocation?: () => void;
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
  onSend,
  onSendMedia,
  onSendLocation,
  disabled,
  error,
  placeholder = 'Type a message...',
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

          {/* Location button */}
          {onSendLocation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" onClick={onSendLocation} disabled={disabled}>
                  <MapPin className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send location</TooltipContent>
            </Tooltip>
          )}
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
