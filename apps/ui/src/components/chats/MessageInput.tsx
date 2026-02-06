import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send } from 'lucide-react';
import { useState } from 'react';

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  error?: string | null;
}

/**
 * Message input with send button
 */
export function MessageInput({ onSend, disabled, error }: MessageInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="border-t p-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          className="flex-1"
        />
        <Button type="submit" disabled={disabled || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
