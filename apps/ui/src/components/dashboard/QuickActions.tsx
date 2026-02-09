/**
 * QuickActions - Action toolbar with shortcuts
 */

import { Button } from '@/components/ui/button';
import { slideInLeft, staggerContainer } from '@/lib/motion';
import type { LucideIcon } from 'lucide-react';
import { Activity, Gauge, MessageSquare, Plus, Server } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';

interface QuickAction {
  label: string;
  icon: LucideIcon;
  href: string;
  variant?: 'default' | 'glow';
}

const defaultActions: QuickAction[] = [
  {
    label: 'New Instance',
    icon: Plus,
    href: '/instances',
    variant: 'glow',
  },
  {
    label: 'View Chats',
    icon: MessageSquare,
    href: '/chats',
  },
  {
    label: 'View Events',
    icon: Activity,
    href: '/events',
  },
  {
    label: 'Check Health',
    icon: Gauge,
    href: '/system',
  },
  {
    label: 'All Instances',
    icon: Server,
    href: '/instances',
  },
];

interface QuickActionsProps {
  actions?: QuickAction[];
}

export function QuickActions({ actions = defaultActions }: QuickActionsProps) {
  const navigate = useNavigate();

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <motion.div key={action.label} variants={slideInLeft}>
          <Button
            variant={action.variant === 'glow' ? 'default' : 'outline'}
            size="sm"
            onClick={() => navigate(action.href)}
            className="gap-2"
          >
            <action.icon className="h-4 w-4" />
            {action.label}
          </Button>
        </motion.div>
      ))}
    </motion.div>
  );
}
