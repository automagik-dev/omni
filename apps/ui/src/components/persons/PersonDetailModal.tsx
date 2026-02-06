import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { usePersonPresence } from '@/hooks/usePersons';
import { formatDateTime } from '@/lib/utils';
import { Mail, Phone, User } from 'lucide-react';

interface PersonDetailModalProps {
  personId: string | null;
  onClose: () => void;
}

/**
 * Modal showing detailed person information and identities
 */
export function PersonDetailModal({ personId, onClose }: PersonDetailModalProps) {
  const { data: presence, isLoading } = usePersonPresence(personId ?? undefined);

  return (
    <Dialog open={!!personId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Person Details</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : presence ? (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{presence.person.displayName ?? 'Unknown'}</h3>
                <p className="font-mono text-xs text-muted-foreground">{presence.person.id}</p>
              </div>
            </div>

            {/* Contact Info */}
            <div className="space-y-2">
              <h4 className="font-medium">Contact Information</h4>
              <div className="space-y-2 text-sm">
                {presence.person.email ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{presence.person.email}</span>
                  </div>
                ) : null}
                {presence.person.phone ? (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{presence.person.phone}</span>
                  </div>
                ) : null}
                {!presence.person.email && !presence.person.phone && (
                  <p className="italic text-muted-foreground">No contact information</p>
                )}
              </div>
            </div>

            {/* Identities */}
            {presence.identities.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Linked Identities ({presence.identities.length})</h4>
                <div className="space-y-2">
                  {presence.identities.map((identity) => (
                    <div
                      key={String(identity.id ?? identity.platformUserId ?? Math.random())}
                      className="flex items-center gap-2 rounded-md border p-2 text-sm"
                    >
                      <Badge variant="outline" className="text-[10px]">
                        {String(identity.channel ?? 'unknown')}
                      </Badge>
                      <span className="truncate font-mono text-xs">
                        {String(identity.platformUserId ?? identity.id ?? 'unknown')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity Summary */}
            {presence.summary && Object.keys(presence.summary).length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Activity Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(presence.summary).map(([key, value]) => (
                    <div key={key} className="rounded-md bg-muted p-2">
                      <p className="text-xs text-muted-foreground">{key}</p>
                      <p className="font-medium">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="border-t pt-4 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Created: {formatDateTime(presence.person.createdAt)}</span>
                <span>Updated: {formatDateTime(presence.person.updatedAt)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-muted-foreground">Person not found</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
