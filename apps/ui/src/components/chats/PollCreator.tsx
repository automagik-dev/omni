import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { SendPollBody } from '@omni/sdk';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface PollCreatorProps {
  open: boolean;
  onClose: () => void;
  onSend: (data: Omit<SendPollBody, 'instanceId' | 'to'>) => void;
}

/**
 * Modal for creating polls (Discord only)
 */
export function PollCreator({ open, onClose, onSend }: PollCreatorProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState('24');
  const [multiSelect, setMultiSelect] = useState(false);

  const handleAddOption = () => {
    if (options.length >= 10) {
      toast.error('Maximum 10 options allowed');
      return;
    }
    setOptions([...options, '']);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length <= 2) {
      toast.error('Minimum 2 options required');
      return;
    }
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleSend = () => {
    if (!question.trim()) {
      toast.error('Please enter a question');
      return;
    }

    const validOptions = options.filter((opt) => opt.trim());
    if (validOptions.length < 2) {
      toast.error('Please enter at least 2 options');
      return;
    }

    const durationHours = Number.parseInt(duration);
    if (Number.isNaN(durationHours) || durationHours <= 0) {
      toast.error('Please enter a valid duration');
      return;
    }

    onSend({
      question: question.trim(),
      answers: validOptions.map((opt) => opt.trim()),
      durationHours,
      multiSelect,
    });

    // Reset form
    setQuestion('');
    setOptions(['', '']);
    setDuration('24');
    setMultiSelect(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Poll</DialogTitle>
          <DialogDescription>Create a poll for this Discord channel</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="question">Question *</Label>
            <Input
              id="question"
              placeholder="What's your favorite color?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Options * (2-10)</Label>
            <div className="space-y-2">
              {options.map((option, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Options are simple strings without unique IDs
                <div key={`option-${index}`} className="flex gap-2">
                  <Input
                    placeholder={`Option ${index + 1}`}
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                  />
                  {options.length > 2 && (
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveOption(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <Button variant="outline" size="sm" onClick={handleAddOption} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Add Option
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration (hours)</Label>
            <Input
              id="duration"
              type="number"
              min="1"
              max="168"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="multiSelect">Allow multiple selections</Label>
            <Switch id="multiSelect" checked={multiSelect} onCheckedChange={setMultiSelect} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!question.trim()}>
            Create Poll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
