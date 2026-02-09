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
import type { SendLocationBody } from '@omni/sdk';
import { MapPin, Navigation } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface LocationPickerProps {
  open: boolean;
  onClose: () => void;
  onSend: (data: Omit<SendLocationBody, 'instanceId' | 'to'>) => void;
}

/**
 * Modal for sharing location
 */
export function LocationPicker({ open, onClose, onSend }: LocationPickerProps) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    setIsGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toString());
        setLongitude(position.coords.longitude.toString());
        setIsGettingLocation(false);
        toast.success('Current location obtained');
      },
      (error) => {
        setIsGettingLocation(false);
        toast.error(`Failed to get location: ${error.message}`);
      },
    );
  };

  const handleSend = () => {
    const lat = Number.parseFloat(latitude);
    const lon = Number.parseFloat(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      toast.error('Please enter valid coordinates');
      return;
    }

    onSend({
      latitude: lat,
      longitude: lon,
      name: name.trim() || undefined,
      address: address.trim() || undefined,
    });

    // Reset form
    setLatitude('');
    setLongitude('');
    setName('');
    setAddress('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Location</DialogTitle>
          <DialogDescription>Share a location with this chat</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current location button */}
          <Button variant="outline" className="w-full" onClick={handleUseCurrentLocation} disabled={isGettingLocation}>
            <Navigation className="mr-2 h-4 w-4" />
            {isGettingLocation ? 'Getting location...' : 'Use Current Location'}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or enter manually</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="latitude">Latitude *</Label>
              <Input
                id="latitude"
                type="number"
                step="any"
                placeholder="40.7128"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="longitude">Longitude *</Label>
              <Input
                id="longitude"
                type="number"
                step="any"
                placeholder="-74.0060"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Place Name</Label>
            <Input id="name" placeholder="Times Square" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              placeholder="Manhattan, NY 10036"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!latitude || !longitude}>
            <MapPin className="mr-2 h-4 w-4" />
            Send Location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
