/**
 * InstanceHealthGrid - Visual grid of instance health cards
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { staggerContainer } from '@/lib/motion';
import { Server } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { InstanceHealthCard } from './InstanceHealthCard';

interface InstanceHealthGridProps {
  instances?: Array<{
    id: string;
    name: string;
    channel: string;
    isActive: boolean;
  }>;
  isLoading?: boolean;
  onInstanceClick?: (id: string) => void;
}

export function InstanceHealthGrid({ instances, isLoading, onInstanceClick }: InstanceHealthGridProps) {
  const navigate = useNavigate();

  const handleInstanceClick = (id: string) => {
    if (onInstanceClick) {
      onInstanceClick(id);
    } else {
      navigate(`/instances/${id}`);
    }
  };

  const connectedCount = instances?.filter((i) => i.isActive).length ?? 0;
  const totalCount = instances?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          Instance Health
        </CardTitle>
        <CardDescription>
          {connectedCount} of {totalCount} instances connected
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !instances || instances.length === 0 ? (
          <div className="py-8 text-center">
            <Server className="mx-auto h-12 w-12 text-muted-foreground opacity-20" />
            <p className="mt-4 text-muted-foreground">No instances configured</p>
            <Link to="/instances">
              <Button className="mt-4" size="sm">
                Create Instance
              </Button>
            </Link>
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {instances.map((instance) => (
              <InstanceHealthCard
                key={instance.id}
                instance={instance}
                onClick={() => handleInstanceClick(instance.id)}
              />
            ))}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
