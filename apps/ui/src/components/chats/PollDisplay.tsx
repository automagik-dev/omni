import { cn } from '@/lib/utils';
import type { ExtendedMessage } from '@/types/message';
import { CheckCircle, Circle } from 'lucide-react';

interface PollDisplayProps {
  message: ExtendedMessage;
  isFromMe: boolean;
}

interface PollOption {
  id: string;
  text: string;
  votes?: number;
  voted?: boolean;
}

interface PollData {
  question: string;
  options: PollOption[];
  allowMultipleAnswers?: boolean;
  totalVotes?: number;
}

/**
 * Extract poll data from message
 * Handles Discord and WhatsApp poll formats
 */
function extractPollData(message: ExtendedMessage): PollData | null {
  try {
    // Try rawPayload first (Discord format)
    if (message.rawPayload) {
      const payload = typeof message.rawPayload === 'string' ? JSON.parse(message.rawPayload) : message.rawPayload;

      // Discord poll format
      if (payload.poll) {
        const { poll } = payload;
        return {
          question: poll.question?.text || 'Poll',
          allowMultipleAnswers: poll.allow_multiselect || false,
          options:
            // biome-ignore lint/suspicious/noExplicitAny: Discord poll format is dynamic
            poll.answers?.map((answer: any, index: number) => ({
              id: String(answer.answer_id || index),
              text: answer.poll_media?.text || `Option ${index + 1}`,
              votes: 0, // Discord doesn't expose vote counts in message payload
              voted: false,
            })) || [],
          totalVotes: 0,
        };
      }

      // WhatsApp poll format (if we have it in rawPayload)
      if (payload.pollName || payload.options) {
        return {
          question: payload.pollName || payload.name || 'Poll',
          allowMultipleAnswers: payload.selectableCount ? payload.selectableCount > 1 : false,
          // biome-ignore lint/suspicious/noExplicitAny: WhatsApp poll format is dynamic
          options: (payload.options || []).map((opt: any, index: number) => ({
            id: String(index),
            text: opt.optionName || opt.name || `Option ${index + 1}`,
            votes: opt.votes || 0,
            voted: opt.voted || false,
          })),
          // biome-ignore lint/suspicious/noExplicitAny: WhatsApp poll format is dynamic
          totalVotes: payload.options?.reduce((sum: number, opt: any) => sum + (opt.votes || 0), 0) || 0,
        };
      }
    }

    // Try textContent as fallback (might be formatted string)
    if (message.textContent) {
      const text = message.textContent;
      const lines = text.split('\n').filter((l) => l.trim());

      if (lines.length > 0) {
        // Simple format: first line is question, rest are options
        return {
          question: lines[0] || 'Poll',
          options: lines.slice(1).map((line, index) => ({
            id: String(index),
            text: line.replace(/^[\d\-\*\•]\s*/, ''), // Remove bullets/numbers
            votes: 0,
            voted: false,
          })),
          allowMultipleAnswers: false,
          totalVotes: 0,
        };
      }
    }

    return null;
  } catch (error) {
    // Silently handle parse errors - fallback UI will be shown
    void error;
    return null;
  }
}

/**
 * Poll display component
 * Shows question, options with vote bars, and results
 */
export function PollDisplay({ message, isFromMe }: PollDisplayProps) {
  const pollData = extractPollData(message);

  // Fallback if we can't parse poll data
  if (!pollData) {
    return (
      <div className="p-3">
        <div className={cn('text-sm italic', isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          [poll]
          {message.textContent && <p className="mt-1 text-xs opacity-70">{message.textContent}</p>}
        </div>
      </div>
    );
  }

  const { question, options, allowMultipleAnswers, totalVotes = 0 } = pollData;
  const hasVotes = totalVotes > 0;

  return (
    <div className="p-3 space-y-3">
      {/* Poll header */}
      <div className="space-y-1">
        <p className="font-medium text-sm">{question}</p>
        <p className={cn('text-xs', isFromMe ? 'text-primary-foreground/60' : 'text-muted-foreground/70')}>
          {allowMultipleAnswers ? 'Multiple answers allowed' : 'Single answer'}
        </p>
      </div>

      {/* Poll options */}
      <div className="space-y-2">
        {options.map((option) => {
          const percentage = hasVotes && option.votes ? Math.round((option.votes / totalVotes) * 100) : 0;

          return (
            <div key={option.id} className="space-y-1">
              {/* Option text and vote indicator */}
              <div className="flex items-center gap-2">
                {option.voted ? (
                  <CheckCircle
                    className={cn('h-4 w-4 shrink-0', isFromMe ? 'text-primary-foreground' : 'text-primary')}
                  />
                ) : (
                  <Circle
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isFromMe ? 'text-primary-foreground/40' : 'text-muted-foreground/40',
                    )}
                  />
                )}
                <span className="flex-1 text-sm">{option.text}</span>
                {hasVotes && (
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {percentage}%
                  </span>
                )}
              </div>

              {/* Vote bar */}
              {hasVotes && (
                <div
                  className={cn(
                    'h-1.5 rounded-full overflow-hidden',
                    isFromMe ? 'bg-primary-foreground/10' : 'bg-muted',
                  )}
                >
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      option.voted
                        ? isFromMe
                          ? 'bg-primary-foreground'
                          : 'bg-primary'
                        : isFromMe
                          ? 'bg-primary-foreground/50'
                          : 'bg-muted-foreground/50',
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Vote count footer */}
      {hasVotes && (
        <p className={cn('text-xs', isFromMe ? 'text-primary-foreground/60' : 'text-muted-foreground/70')}>
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </p>
      )}
    </div>
  );
}
