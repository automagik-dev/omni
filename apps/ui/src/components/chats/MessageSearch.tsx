import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useMessageSearch } from '@/hooks/useMessageSearch';
import { formatDateTime } from '@/lib/utils';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface MessageSearchProps {
  chatId: string;
  instanceId: string;
  onClose: () => void;
  onResultClick?: (messageId: string) => void;
}

/**
 * Message search overlay for chat
 * Slides down from header with real-time search results
 */
export function MessageSearch({ chatId, instanceId, onClose, onResultClick }: MessageSearchProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, isSearching } = useMessageSearch(chatId, instanceId, query);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleResultClick = (event: React.MouseEvent, eventId: string) => {
    event.preventDefault();
    if (onResultClick) {
      onResultClick(eventId);
    }
    onClose();
  };

  return (
    <div className="absolute top-full left-0 right-0 z-40 border-b bg-card shadow-lg animate-in slide-in-from-top duration-200">
      {/* Search input */}
      <div className="flex items-center gap-2 p-3 border-b">
        <Search className="h-5 w-5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 border-none shadow-none focus-visible:ring-0"
        />
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Results */}
      <div className="max-h-96 overflow-auto">
        {isSearching ? (
          <div className="flex justify-center p-8">
            <Spinner size="sm" />
          </div>
        ) : query.length < 3 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Type at least 3 characters to search</div>
        ) : results.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No messages found for "{query}"</div>
        ) : (
          <div className="divide-y">
            {results.map((event) => (
              <button
                type="button"
                key={event.id}
                onClick={(e) => handleResultClick(e, event.id)}
                className="w-full p-3 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Message preview */}
                    <p className="text-sm line-clamp-2 mb-1">
                      {highlightQuery(String(event.textContent || event.transcription || '[No text]'), query)}
                    </p>
                    {/* Timestamp */}
                    <p className="text-xs text-muted-foreground">{formatDateTime(event.receivedAt)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Highlight search query in text
 */
function highlightQuery(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const regex = new RegExp(`(${query})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part: string, i: number) =>
    regex.test(part) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: Text split parts have no better identifier
      <mark key={`mark-${i}`} className="bg-yellow-200/50 dark:bg-yellow-500/30">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
