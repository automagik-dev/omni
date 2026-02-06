import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Contact } from '@omni/sdk';
import { Building, Phone, User, Users } from 'lucide-react';

interface ContactCardProps {
  contact: Contact;
  onClick?: () => void;
}

/**
 * Card displaying a contact from a channel instance
 */
export function ContactCard({ contact, onClick }: ContactCardProps) {
  const isGroup = contact.isGroup;
  const Icon = isGroup ? Users : User;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent')}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        {contact.avatarUrl ? (
          <img src={contact.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <Icon className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{contact.displayName ?? contact.platformUserId}</span>
          {contact.isBusiness && <Building className="h-4 w-4 shrink-0 text-blue-500" aria-label="Business" />}
        </div>

        <div className="mt-1 space-y-1 text-sm text-muted-foreground">
          {contact.phone && (
            <div className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              <span className="truncate">{contact.phone}</span>
            </div>
          )}
          <p className="truncate font-mono text-xs">{contact.platformUserId}</p>
        </div>

        {/* Badges */}
        <div className="mt-2 flex flex-wrap gap-1">
          {isGroup && (
            <Badge variant="secondary" className="text-[10px]">
              Group
            </Badge>
          )}
          {contact.isBusiness && (
            <Badge variant="outline" className="text-[10px]">
              Business
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
