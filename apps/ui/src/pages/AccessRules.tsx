import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAccessRules, useCheckAccess, useCreateAccessRule, useDeleteAccessRule } from '@/hooks/useAccessRules';
import { useInstances } from '@/hooks/useInstances';
import { cn, formatDateTime } from '@/lib/utils';
import type { AccessRule, CreateAccessRuleBody } from '@omni/sdk';
import { AlertCircle, CheckCircle2, Plus, Search, Shield, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';

type RuleType = 'allow' | 'deny';
type ActionType = 'block' | 'allow' | 'silent_block';

const ruleTypeConfig: Record<RuleType, { label: string; icon: typeof Shield; color: string }> = {
  allow: { label: 'Allow', icon: ShieldCheck, color: 'text-green-500' },
  deny: { label: 'Deny', icon: ShieldBan, color: 'text-red-500' },
};

const actionConfig: Record<ActionType, { label: string; description: string }> = {
  allow: { label: 'Allow', description: 'Allow access' },
  block: { label: 'Block', description: 'Block with message' },
  silent_block: { label: 'Silent Block', description: 'Block without notification' },
};

export function AccessRules() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);

  const { data: rules, isLoading } = useAccessRules();
  const deleteRule = useDeleteAccessRule();

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    await deleteRule.mutateAsync(id);
  };

  const allowRules = rules?.filter((r) => r.ruleType === 'allow') || [];
  const denyRules = rules?.filter((r) => r.ruleType === 'deny') || [];

  return (
    <>
      <Header
        title="Access Control"
        subtitle="Manage allow and deny rules for incoming messages"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowTestModal(true)}>
              <Search className="mr-2 h-4 w-4" />
              Test Access
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Rule
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : !rules || rules.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">No access rules</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create rules to control who can send messages to your instances
              </p>
              <Button className="mt-4" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create First Rule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Allow Rules */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  Allow Rules ({allowRules.length})
                </CardTitle>
                <CardDescription>These patterns will be allowed to send messages</CardDescription>
              </CardHeader>
              <CardContent>
                {allowRules.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No allow rules configured</p>
                ) : (
                  <div className="space-y-2">
                    {allowRules.map((rule) => (
                      <RuleItem key={rule.id} rule={rule} onDelete={() => handleDelete(rule.id)} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Deny Rules */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldBan className="h-5 w-5 text-red-500" />
                  Deny Rules ({denyRules.length})
                </CardTitle>
                <CardDescription>These patterns will be blocked from sending messages</CardDescription>
              </CardHeader>
              <CardContent>
                {denyRules.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No deny rules configured</p>
                ) : (
                  <div className="space-y-2">
                    {denyRules.map((rule) => (
                      <RuleItem key={rule.id} rule={rule} onDelete={() => handleDelete(rule.id)} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <CreateRuleModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <TestAccessModal open={showTestModal} onClose={() => setShowTestModal(false)} />
    </>
  );
}

// Rule item component
function RuleItem({ rule, onDelete }: { rule: AccessRule; onDelete: () => void }) {
  const config = ruleTypeConfig[rule.ruleType];
  const Icon = config.icon;

  return (
    <div className="flex items-start justify-between rounded-lg border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', config.color)} />
          <span className="font-mono text-sm">{rule.phonePattern || rule.platformUserId || 'All users'}</span>
          {!rule.enabled && (
            <Badge variant="secondary" className="text-[10px]">
              Disabled
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Priority: {rule.priority}</span>
          <span>•</span>
          <span>Action: {actionConfig[rule.action].label}</span>
          {rule.instanceId && (
            <>
              <span>•</span>
              <span>Instance specific</span>
            </>
          )}
        </div>
        {rule.reason && <p className="text-xs text-muted-foreground">{rule.reason}</p>}
        {rule.expiresAt && <p className="text-xs text-orange-500">Expires: {formatDateTime(rule.expiresAt)}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Create rule modal
function CreateRuleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ruleType, setRuleType] = useState<RuleType>('deny');
  const [action, setAction] = useState<ActionType>('block');
  const [phonePattern, setPhonePattern] = useState('');
  const [platformUserId, setPlatformUserId] = useState('');
  const [priority, setPriority] = useState(0);
  const [reason, setReason] = useState('');
  const [instanceId, setInstanceId] = useState<string>('');
  const [blockMessage, setBlockMessage] = useState('');

  const { data: instancesResponse } = useInstances();
  const instances = instancesResponse?.items || [];
  const createRule = useCreateAccessRule();

  const handleSubmit = async () => {
    const body: CreateAccessRuleBody = {
      ruleType,
      action,
      priority,
      enabled: true,
    };

    if (phonePattern) body.phonePattern = phonePattern;
    if (platformUserId) body.platformUserId = platformUserId;
    if (reason) body.reason = reason;
    if (instanceId) body.instanceId = instanceId;
    if (blockMessage && action === 'block') body.blockMessage = blockMessage;

    await createRule.mutateAsync(body);
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setRuleType('deny');
    setAction('block');
    setPhonePattern('');
    setPlatformUserId('');
    setPriority(0);
    setReason('');
    setInstanceId('');
    setBlockMessage('');
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Access Rule</DialogTitle>
          <DialogDescription>Define a rule to allow or deny access for specific patterns</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Rule Type */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Rule Type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ruleTypeConfig) as RuleType[]).map((type) => {
                const config = ruleTypeConfig[type];
                const Icon = config.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setRuleType(type)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border p-3 transition-colors',
                      ruleType === type ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50',
                    )}
                  >
                    <Icon className={cn('h-5 w-5', config.color)} />
                    <span className="font-medium">{config.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Pattern */}
          <div className="space-y-2">
            <label htmlFor="phone-pattern" className="text-sm font-medium">
              Phone Pattern
            </label>
            <Input
              id="phone-pattern"
              value={phonePattern}
              onChange={(e) => setPhonePattern(e.target.value)}
              placeholder="+1555* or exact number"
            />
            <p className="text-xs text-muted-foreground">
              Use * as wildcard. Leave empty for platform user ID matching.
            </p>
          </div>

          {/* Platform User ID */}
          <div className="space-y-2">
            <label htmlFor="platform-user-id" className="text-sm font-medium">
              Platform User ID (alternative)
            </label>
            <Input
              id="platform-user-id"
              value={platformUserId}
              onChange={(e) => setPlatformUserId(e.target.value)}
              placeholder="Exact platform user ID"
              disabled={!!phonePattern}
            />
          </div>

          {/* Instance */}
          <div className="space-y-2">
            <label htmlFor="instance-select" className="text-sm font-medium">
              Instance (optional)
            </label>
            <select
              id="instance-select"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">All instances (global)</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} ({instance.channel})
                </option>
              ))}
            </select>
          </div>

          {/* Action */}
          {ruleType === 'deny' && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Action</legend>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(actionConfig) as ActionType[])
                  .filter((a) => a !== 'allow')
                  .map((actionType) => (
                    <button
                      key={actionType}
                      type="button"
                      onClick={() => setAction(actionType)}
                      className={cn(
                        'rounded-lg border p-2 text-center text-sm transition-colors',
                        action === actionType ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50',
                      )}
                    >
                      {actionConfig[actionType].label}
                    </button>
                  ))}
              </div>
            </fieldset>
          )}

          {/* Block Message */}
          {ruleType === 'deny' && action === 'block' && (
            <div className="space-y-2">
              <label htmlFor="block-message" className="text-sm font-medium">
                Block Message
              </label>
              <Input
                id="block-message"
                value={blockMessage}
                onChange={(e) => setBlockMessage(e.target.value)}
                placeholder="Optional message shown to blocked user"
              />
            </div>
          )}

          {/* Priority */}
          <div className="space-y-2">
            <label htmlFor="priority" className="text-sm font-medium">
              Priority
            </label>
            <Input id="priority" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">Higher priority rules are checked first</p>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <label htmlFor="reason" className="text-sm font-medium">
              Reason (optional)
            </label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this rule exists"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createRule.isPending || (!phonePattern && !platformUserId)}>
            {createRule.isPending ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Creating...
              </>
            ) : (
              'Create Rule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Test access modal
function TestAccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [instanceId, setInstanceId] = useState('');
  const [platformUserId, setPlatformUserId] = useState('');
  const [channel, setChannel] = useState('whatsapp');

  const { data: instancesResponse } = useInstances();
  const instances = instancesResponse?.items || [];
  const checkAccess = useCheckAccess();

  const handleTest = async () => {
    if (!instanceId || !platformUserId) return;
    await checkAccess.mutateAsync({ instanceId, platformUserId, channel });
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Test Access</DialogTitle>
          <DialogDescription>Check if a specific user would be allowed or denied</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label htmlFor="test-instance" className="text-sm font-medium">
              Instance
            </label>
            <select
              id="test-instance"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select an instance</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} ({instance.channel})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="test-user-id" className="text-sm font-medium">
              Platform User ID
            </label>
            <Input
              id="test-user-id"
              value={platformUserId}
              onChange={(e) => setPlatformUserId(e.target.value)}
              placeholder="e.g., 15551234567@s.whatsapp.net"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="test-channel" className="text-sm font-medium">
              Channel
            </label>
            <select
              id="test-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="discord">Discord</option>
            </select>
          </div>

          {/* Result */}
          {checkAccess.data && (
            <div
              className={cn(
                'rounded-lg border p-4',
                checkAccess.data.allowed ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5',
              )}
            >
              <div className="flex items-center gap-2">
                {checkAccess.data.allowed ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="font-medium text-green-600">Access Allowed</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-5 w-5 text-red-500" />
                    <span className="font-medium text-red-600">Access Denied</span>
                  </>
                )}
              </div>
              {checkAccess.data.reason && (
                <p className="mt-2 text-sm text-muted-foreground">{checkAccess.data.reason}</p>
              )}
            </div>
          )}

          {checkAccess.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm text-red-600">
                {checkAccess.error instanceof Error ? checkAccess.error.message : 'Failed to check access'}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleTest} disabled={checkAccess.isPending || !instanceId || !platformUserId}>
            {checkAccess.isPending ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Checking...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Test
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
