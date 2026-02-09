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
import type { SendContactBody } from '@omni/sdk';
import { useState } from 'react';

interface ContactPickerProps {
  open: boolean;
  onClose: () => void;
  onSend: (data: Omit<SendContactBody, 'instanceId' | 'to'>) => void;
}

/**
 * Modal for creating and sending contact cards
 */
export function ContactPicker({ open, onClose, onSend }: ContactPickerProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');

  const handleSend = () => {
    if (!name.trim() || !phone.trim()) {
      return;
    }

    onSend({
      contact: {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        organization: organization.trim() || undefined,
      },
    });

    // Reset form
    setName('');
    setPhone('');
    setEmail('');
    setOrganization('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Contact</DialogTitle>
          <DialogDescription>Share a contact card with this chat</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+1234567890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="organization">Organization</Label>
            <Input
              id="organization"
              placeholder="Acme Corp"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!name.trim() || !phone.trim()}>
            Send Contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
