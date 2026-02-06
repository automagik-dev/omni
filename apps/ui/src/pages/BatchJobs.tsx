import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  useBatchJobStatus,
  useBatchJobs,
  useCancelBatchJob,
  useCreateBatchJob,
  useEstimateBatchJob,
} from '@/hooks/useBatchJobs';
import { useChats } from '@/hooks/useChats';
import { useInstances } from '@/hooks/useInstances';
import { cn } from '@/lib/utils';
import type { BatchJob, BatchJobStatus, BatchJobType } from '@omni/sdk';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

// Content type options
const CONTENT_TYPES = [
  { value: 'audio', label: 'Audio', icon: FileAudio },
  { value: 'image', label: 'Images', icon: FileImage },
  { value: 'video', label: 'Video', icon: FileVideo },
  { value: 'document', label: 'Documents', icon: FileText },
] as const;

// Time range options
const TIME_RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: -1, label: 'All time' },
];

// Status badges
const STATUS_CONFIG: Record<
  BatchJobStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof Clock }
> = {
  pending: { label: 'Pending', variant: 'secondary', icon: Clock },
  running: { label: 'Running', variant: 'default', icon: Loader2 },
  completed: { label: 'Completed', variant: 'outline', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', variant: 'secondary', icon: XCircle },
};

export function BatchJobs() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BatchJobStatus | 'all'>('all');

  const {
    data: batchJobsResponse,
    isLoading,
    refetch,
  } = useBatchJobs(statusFilter !== 'all' ? { status: [statusFilter] } : undefined);
  const cancelJob = useCancelBatchJob();

  const batchJobs = batchJobsResponse?.items || [];

  const handleCancel = async (id: string) => {
    if (confirm('Are you sure you want to cancel this job?')) {
      await cancelJob.mutateAsync(id);
    }
  };

  return (
    <>
      <Header
        title="Batch Processing"
        subtitle="Process media files in bulk across your chats"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Job
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {/* Status filter */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          {(['all', 'pending', 'running', 'completed', 'failed', 'cancelled'] as const).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {status === 'all' ? 'All' : STATUS_CONFIG[status].label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : batchJobs.length === 0 ? (
          <Card className="mx-auto max-w-md">
            <CardContent className="flex flex-col items-center py-12">
              <Package className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Batch Jobs</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Create a batch job to process media files across your conversations.
              </p>
              <Button className="mt-6" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Job
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {batchJobs.map((job) => (
              <BatchJobCard key={job.id} job={job} onCancel={() => handleCancel(job.id)} />
            ))}
          </div>
        )}
      </div>

      {showCreateModal && <CreateBatchJobModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />}
    </>
  );
}

/**
 * Card displaying a single batch job with progress
 */
function BatchJobCard({ job, onCancel }: { job: BatchJob; onCancel: () => void }) {
  // Poll status if job is running
  const { data: status } = useBatchJobStatus(job.id, {
    enabled: job.status === 'running' || job.status === 'pending',
    refetchInterval: 2000,
  });

  const currentStatus = (status?.status || job.status) as BatchJobStatus;
  const config = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  const processedItems = status?.processedItems ?? job.processedItems;
  const totalItems = status?.totalItems ?? job.totalItems;
  const progressPercent = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 0;

  // Extract chatId and contentTypes from requestParams
  const requestParams = job.requestParams as Record<string, unknown> | undefined;
  const chatId = requestParams?.chatId as string | undefined;
  const contentTypes = requestParams?.contentTypes as string[] | undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant={config.variant} className="gap-1">
                <Icon className={cn('h-3 w-3', currentStatus === 'running' && 'animate-spin')} />
                {config.label}
              </Badge>
              <span className="text-muted-foreground font-mono text-sm">{job.id.slice(0, 8)}</span>
            </CardTitle>
            <CardDescription className="mt-1">
              {job.jobType === 'targeted_chat_sync' ? 'Targeted Chat Sync' : 'Time-Based Batch'}
              {chatId && ` · Chat: ${chatId.slice(0, 12)}...`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {(currentStatus === 'pending' || currentStatus === 'running') && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress bar */}
        {totalItems > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {processedItems} / {totalItems} items
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  currentStatus === 'completed'
                    ? 'bg-green-500'
                    : currentStatus === 'failed'
                      ? 'bg-red-500'
                      : 'bg-primary',
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {status?.currentItem && (
              <p className="text-xs text-muted-foreground truncate">Processing: {status.currentItem}</p>
            )}
          </div>
        )}

        {/* Content types */}
        {contentTypes && contentTypes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {contentTypes.map((type: string) => {
              const typeConfig = CONTENT_TYPES.find((t) => t.value === type);
              const TypeIcon = typeConfig?.icon || FileText;
              return (
                <Badge key={type} variant="outline" className="gap-1">
                  <TypeIcon className="h-3 w-3" />
                  {typeConfig?.label || type}
                </Badge>
              );
            })}
          </div>
        )}

        {/* Error message */}
        {job.errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            {job.errorMessage}
          </div>
        )}

        {/* Timestamps */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Created: {new Date(job.createdAt).toLocaleString()}</span>
          {job.completedAt && <span>Completed: {new Date(job.completedAt).toLocaleString()}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Modal for creating a new batch job
 */
function CreateBatchJobModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<'type' | 'config' | 'estimate'>('type');
  const [jobType, setJobType] = useState<BatchJobType>('targeted_chat_sync');
  const [instanceId, setInstanceId] = useState<string>('');
  const [chatId, setChatId] = useState<string>('');
  const [contentTypes, setContentTypes] = useState<string[]>(['audio', 'image']);
  const [daysBack, setDaysBack] = useState<number>(30);

  const { data: instancesResponse } = useInstances();
  const { data: chatsResponse } = useChats({ instanceId: instanceId || undefined, limit: 50 });
  const createJob = useCreateBatchJob();
  const estimateJob = useEstimateBatchJob();

  const instances = instancesResponse?.items || [];
  const chats = chatsResponse?.items || [];

  if (!open) return null;

  const toggleContentType = (type: string) => {
    if (contentTypes.includes(type)) {
      setContentTypes(contentTypes.filter((t) => t !== type));
    } else {
      setContentTypes([...contentTypes, type]);
    }
  };

  const handleEstimate = async () => {
    const body = {
      jobType,
      instanceId,
      chatId: jobType === 'targeted_chat_sync' ? chatId : undefined,
      contentTypes: contentTypes as ('audio' | 'image' | 'video' | 'document')[],
      daysBack: daysBack === -1 ? undefined : daysBack,
    };
    await estimateJob.mutateAsync(body);
    setStep('estimate');
  };

  const handleCreate = async () => {
    const body = {
      jobType,
      instanceId,
      chatId: jobType === 'targeted_chat_sync' ? chatId : undefined,
      contentTypes: contentTypes as ('audio' | 'image' | 'video' | 'document')[],
      daysBack: daysBack === -1 ? undefined : daysBack,
    };
    await createJob.mutateAsync(body);
    onClose();
  };

  const canProceed = () => {
    if (step === 'type') return jobType;
    if (step === 'config') {
      if (!instanceId) return false;
      if (jobType === 'targeted_chat_sync' && !chatId) return false;
      if (contentTypes.length === 0) return false;
      return true;
    }
    return true;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg">
        <CardHeader className="relative">
          <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
          <CardTitle>Create Batch Job</CardTitle>
          <CardDescription>
            {step === 'type' && 'Select the type of batch processing job'}
            {step === 'config' && 'Configure the job parameters'}
            {step === 'estimate' && 'Review cost estimate before starting'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: Job Type */}
          {step === 'type' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setJobType('targeted_chat_sync')}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                  jobType === 'targeted_chat_sync' ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50',
                )}
              >
                <Package className="h-5 w-5 mt-0.5 text-primary" />
                <div className="flex-1">
                  <p className="font-medium">Targeted Chat Sync</p>
                  <p className="text-sm text-muted-foreground">Process media from a specific chat</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setJobType('time_based_batch')}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                  jobType === 'time_based_batch' ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50',
                )}
              >
                <Clock className="h-5 w-5 mt-0.5 text-primary" />
                <div className="flex-1">
                  <p className="font-medium">Time-Based Batch</p>
                  <p className="text-sm text-muted-foreground">Process all media within a time range</p>
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Configuration */}
          {step === 'config' && (
            <div className="space-y-4">
              {/* Instance selector */}
              <div className="space-y-2">
                <label htmlFor="batch-instance" className="text-sm font-medium">
                  Instance
                </label>
                <select
                  id="batch-instance"
                  value={instanceId}
                  onChange={(e) => {
                    setInstanceId(e.target.value);
                    setChatId('');
                  }}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select an instance...</option>
                  {instances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name} ({instance.channel})
                    </option>
                  ))}
                </select>
              </div>

              {/* Chat selector (for targeted sync) */}
              {jobType === 'targeted_chat_sync' && (
                <div className="space-y-2">
                  <label htmlFor="batch-chat" className="text-sm font-medium">
                    Chat
                  </label>
                  <select
                    id="batch-chat"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    disabled={!instanceId}
                  >
                    <option value="">Select a chat...</option>
                    {chats.map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.name || chat.externalId}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Content types */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Content Types</legend>
                <div className="grid grid-cols-2 gap-2">
                  {CONTENT_TYPES.map((type) => {
                    const Icon = type.icon;
                    const selected = contentTypes.includes(type.value);
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => toggleContentType(type.value)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border p-3 transition-colors',
                          selected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50',
                        )}
                      >
                        <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="text-sm">{type.label}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* Time range */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Time Range</legend>
                <div className="flex flex-wrap gap-2">
                  {TIME_RANGES.map((range) => (
                    <Button
                      key={range.value}
                      variant={daysBack === range.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDaysBack(range.value)}
                    >
                      {range.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {/* Step 3: Estimate */}
          {step === 'estimate' && estimateJob.data && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total items</span>
                  <span className="font-medium">{estimateJob.data.totalItems}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Audio</span>
                    <span>{estimateJob.data.audioCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Images</span>
                    <span>{estimateJob.data.imageCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Video</span>
                    <span>{estimateJob.data.videoCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Documents</span>
                    <span>{estimateJob.data.documentCount}</span>
                  </div>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="text-muted-foreground">Est. duration</span>
                  <span className="font-medium">{estimateJob.data.estimatedDurationMinutes} min</span>
                </div>
                <div className="flex justify-between text-lg">
                  <span className="font-medium">Estimated cost</span>
                  <span className="font-bold text-primary">${estimateJob.data.estimatedCostUsd.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>

        {/* Footer */}
        <div className="border-t p-4 flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 'config') setStep('type');
              else if (step === 'estimate') setStep('config');
              else onClose();
            }}
          >
            {step === 'type' ? 'Cancel' : 'Back'}
          </Button>

          {step === 'type' && (
            <Button onClick={() => setStep('config')} disabled={!canProceed()}>
              Continue
            </Button>
          )}

          {step === 'config' && (
            <Button onClick={handleEstimate} disabled={!canProceed() || estimateJob.isPending}>
              {estimateJob.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Estimating...
                </>
              ) : (
                'Get Estimate'
              )}
            </Button>
          )}

          {step === 'estimate' && (
            <Button onClick={handleCreate} disabled={createJob.isPending}>
              {createJob.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Creating...
                </>
              ) : (
                'Start Job'
              )}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
