import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

// Generate consistent background color from name
function getInitialsColor(name: string): string {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500',
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Get initials from name (max 2 characters)
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Avatar component with image or initials fallback
 */
export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  const sizeClass = sizeClasses[size];
  const displayName = name || '?';

  if (src) {
    return (
      <img src={src} alt={displayName} className={cn('shrink-0 rounded-full object-cover', sizeClass, className)} />
    );
  }

  // Fallback to initials
  const initials = getInitials(displayName);
  const bgColor = getInitialsColor(displayName);

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-medium text-white',
        sizeClass,
        bgColor,
        className,
      )}
      title={displayName}
    >
      {initials}
    </div>
  );
}

/**
 * Avatar group for showing multiple avatars with overlap
 */
export function AvatarGroup({
  avatars,
  max = 3,
  size = 'sm',
}: {
  avatars: Array<{ src?: string | null; name?: string | null }>;
  max?: number;
  size?: 'sm' | 'md';
}) {
  const visible = avatars.slice(0, max);
  const remaining = avatars.length - max;

  return (
    <div className="flex -space-x-2">
      {visible.map((avatar) => (
        <Avatar
          key={avatar.name || avatar.src || Math.random().toString()}
          src={avatar.src}
          name={avatar.name}
          size={size}
          className="ring-2 ring-background"
        />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-muted font-medium ring-2 ring-background',
            size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm',
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
