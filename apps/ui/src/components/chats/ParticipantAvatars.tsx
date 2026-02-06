import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChatParticipant } from '@omni/sdk';

interface ParticipantAvatarsProps {
  participants: ChatParticipant[];
  maxDisplay?: number;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

const OFFSET_CLASSES = {
  sm: '-ml-2',
  md: '-ml-2.5',
  lg: '-ml-3',
};

/**
 * Display stacked participant avatars with tooltip
 */
export function ParticipantAvatars({ participants, maxDisplay = 5, size = 'sm' }: ParticipantAvatarsProps) {
  if (!participants || participants.length === 0) return null;

  const displayed = participants.slice(0, maxDisplay);
  const remaining = participants.length - maxDisplay;
  const sizeClass = SIZE_CLASSES[size];
  const offsetClass = OFFSET_CLASSES[size];

  return (
    <TooltipProvider>
      <div className="flex items-center">
        {displayed.map((participant, index) => (
          <Tooltip key={participant.id} delayDuration={300}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'relative flex shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted',
                  sizeClass,
                  index > 0 && offsetClass,
                )}
                style={{ zIndex: displayed.length - index }}
              >
                {participant.avatarUrl ? (
                  <img
                    src={participant.avatarUrl}
                    alt={participant.displayName || 'Participant'}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="font-medium text-muted-foreground">
                    {getInitials(participant.displayName || participant.platformUserId)}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {participant.displayName || participant.platformUserId}
                {participant.role && <span className="ml-1 text-muted-foreground">({participant.role})</span>}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}

        {remaining > 0 && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted font-medium text-muted-foreground',
                  sizeClass,
                  offsetClass,
                )}
              >
                +{remaining}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {remaining} more participant{remaining > 1 ? 's' : ''}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * Get initials from a name or ID
 */
function getInitials(nameOrId: string): string {
  if (!nameOrId) return '?';

  // If it looks like a phone number or ID, use first char
  if (/^[\d+@]/.test(nameOrId)) {
    return nameOrId.charAt(0);
  }

  // Split by space and get first letter of first two words
  const parts = nameOrId.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]?.charAt(0)?.toUpperCase() || '?';
  }
  return (parts[0]?.charAt(0) || '').toUpperCase() + (parts[1]?.charAt(0) || '').toUpperCase();
}

interface ParticipantListProps {
  participants: ChatParticipant[];
  maxDisplay?: number;
}

/**
 * Display participants as a compact text list
 */
export function ParticipantList({ participants, maxDisplay = 3 }: ParticipantListProps) {
  if (!participants || participants.length === 0) return null;

  const displayed = participants.slice(0, maxDisplay);
  const remaining = participants.length - maxDisplay;

  const names = displayed.map((p) => p.displayName || p.platformUserId.split('@')[0] || 'Unknown');

  return (
    <span className="text-sm text-muted-foreground">
      {names.join(', ')}
      {remaining > 0 && ` +${remaining} more`}
    </span>
  );
}
