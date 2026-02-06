import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useDisableAutomation,
  useEnableAutomation,
} from '@/hooks/useAutomations';
import { cn } from '@/lib/utils';
import type { Automation, CreateAutomationBody } from '@omni/sdk';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Trash2,
  Webhook,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

// Event types available for triggering automations
const EVENT_TYPES = [
  { value: 'message.received', label: 'Message Received', description: 'Triggered when a message is received' },
  { value: 'message.sent', label: 'Message Sent', description: 'Triggered when a message is sent' },
  { value: 'chat.created', label: 'Chat Created', description: 'Triggered when a new chat is created' },
  { value: 'instance.connected', label: 'Instance Connected', description: 'When a channel instance connects' },
  { value: 'instance.disconnected', label: 'Instance Disconnected', description: 'When a channel disconnects' },
  { value: 'contact.created', label: 'Contact Created', description: 'When a new contact is added' },
];

// Condition operators
const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'does not exist' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'regex', label: 'matches regex' },
];

// Action types
const ACTION_TYPES = [
  { value: 'webhook', label: 'Call Webhook', icon: Webhook, description: 'Send HTTP request to external URL' },
  { value: 'send_message', label: 'Send Message', icon: MessageSquare, description: 'Send a reply message' },
  { value: 'call_agent', label: 'Call Agent', icon: Zap, description: 'Forward to AI agent for processing' },
  { value: 'log', label: 'Log Event', icon: Filter, description: 'Log the event for debugging' },
];

export function Automations() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const { data: automations, isLoading } = useAutomations();
  const deleteAutomation = useDeleteAutomation();
  const enableAutomation = useEnableAutomation();
  const disableAutomation = useDisableAutomation();

  const handleToggleEnabled = async (automation: Automation) => {
    if (automation.enabled) {
      await disableAutomation.mutateAsync(automation.id);
    } else {
      await enableAutomation.mutateAsync(automation.id);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      await deleteAutomation.mutateAsync(id);
    }
  };

  const handleEdit = (automation: Automation) => {
    setEditingAutomation(automation);
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingAutomation(null);
  };

  return (
    <>
      <Header
        title="Automations"
        subtitle="Create event-driven automations for message handling"
        actions={
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Automation
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : !automations || automations.length === 0 ? (
          <Card className="mx-auto max-w-md">
            <CardContent className="flex flex-col items-center py-12">
              <Zap className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Automations</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Create automations to handle events automatically - debounce messages, forward to agents, and more.
              </p>
              <Button className="mt-6" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Automation
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {automations.map((automation) => (
              <AutomationCard
                key={automation.id}
                automation={automation}
                onToggle={() => handleToggleEnabled(automation)}
                onEdit={() => handleEdit(automation)}
                onDelete={() => handleDelete(automation.id, automation.name)}
                isToggling={
                  (enableAutomation.isPending || disableAutomation.isPending) &&
                  (enableAutomation.variables === automation.id || disableAutomation.variables === automation.id)
                }
              />
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <AutomationModal open={showCreateModal} onClose={handleCloseModal} automation={editingAutomation} />
      )}
    </>
  );
}

/**
 * Card displaying a single automation
 */
function AutomationCard({
  automation,
  onToggle,
  onEdit,
  onDelete,
  isToggling,
}: {
  automation: Automation;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isToggling: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const eventConfig = EVENT_TYPES.find((e) => e.value === automation.triggerEventType);

  return (
    <Card className={cn(!automation.enabled && 'opacity-60')}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-accent rounded">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {automation.name}
                {automation.enabled ? (
                  <Badge variant="default" className="bg-green-500 text-[10px]">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    Disabled
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                {automation.description || `Triggers on ${eventConfig?.label || automation.triggerEventType}`}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onToggle} disabled={isToggling}>
              {isToggling ? (
                <Spinner size="sm" />
              ) : automation.enabled ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-4 border-t">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Trigger */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">TRIGGER</p>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-sm">{eventConfig?.label || automation.triggerEventType}</p>
                <p className="text-xs text-muted-foreground mt-1">{eventConfig?.description || 'Custom event type'}</p>
              </div>
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                CONDITIONS {automation.conditionLogic && `(${automation.conditionLogic.toUpperCase()})`}
              </p>
              <div className="space-y-2">
                {automation.triggerConditions && automation.triggerConditions.length > 0 ? (
                  automation.triggerConditions.map((cond, i) => (
                    <div key={`cond-${cond.field}-${cond.operator}-${i}`} className="rounded-lg border p-2 text-xs">
                      <span className="font-mono">{cond.field}</span>{' '}
                      <span className="text-muted-foreground">
                        {OPERATORS.find((o) => o.value === cond.operator)?.label || cond.operator}
                      </span>{' '}
                      {cond.value !== undefined && <span className="font-mono text-primary">{String(cond.value)}</span>}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">No conditions (always matches)</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">ACTIONS ({automation.actions?.length || 0})</p>
              <div className="space-y-2">
                {automation.actions?.map((action, i) => {
                  const actionConfig = ACTION_TYPES.find((a) => a.value === action.type);
                  const Icon = actionConfig?.icon || Zap;
                  return (
                    <div key={`action-${action.type}-${i}`} className="flex items-center gap-2 rounded-lg border p-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-medium">{actionConfig?.label || action.type}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Debounce info */}
          {automation.debounce && Object.keys(automation.debounce).length > 0 && (
            <div className="mt-4 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium">Debounce Settings</p>
              <pre className="text-xs text-muted-foreground mt-1">{JSON.stringify(automation.debounce, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Modal for creating/editing an automation
 */
function AutomationModal({
  open,
  onClose,
  automation,
}: {
  open: boolean;
  onClose: () => void;
  automation?: Automation | null;
}) {
  const isEditing = !!automation;
  const [step, setStep] = useState<'trigger' | 'conditions' | 'actions'>('trigger');

  // Form state
  const [name, setName] = useState(automation?.name || '');
  const [description, setDescription] = useState(automation?.description || '');
  const [triggerEventType, setTriggerEventType] = useState(automation?.triggerEventType || '');
  const [conditions, setConditions] = useState<Array<{ id: string; field: string; operator: string; value: string }>>(
    automation?.triggerConditions?.map((c, i) => ({
      id: `cond-${Date.now()}-${i}`,
      field: c.field,
      operator: c.operator,
      value: c.value !== undefined ? String(c.value) : '',
    })) || [],
  );
  const [conditionLogic, setConditionLogic] = useState<'and' | 'or'>(automation?.conditionLogic || 'and');
  const [actions, setActions] = useState<Array<{ id: string; type: string; config: Record<string, string> }>>(
    automation?.actions?.map((a, i) => ({
      id: `action-${Date.now()}-${i}`,
      type: a.type,
      config: a.config as Record<string, string>,
    })) || [],
  );

  const createAutomation = useCreateAutomation();

  if (!open) return null;

  const handleAddCondition = () => {
    setConditions([...conditions, { id: `cond-${Date.now()}`, field: '', operator: 'eq', value: '' }]);
  };

  const handleRemoveCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const handleConditionChange = (index: number, field: keyof (typeof conditions)[0], value: string) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setConditions(newConditions);
  };

  const handleAddAction = (type: string) => {
    setActions([...actions, { id: `action-${Date.now()}`, type, config: {} }]);
  };

  const handleRemoveAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  const handleActionConfigChange = (index: number, key: string, value: string) => {
    const newActions = [...actions];
    newActions[index] = {
      ...newActions[index],
      config: { ...newActions[index].config, [key]: value },
    };
    setActions(newActions);
  };

  const handleCreate = async () => {
    if (!name.trim() || !triggerEventType || actions.length === 0) return;

    const body: CreateAutomationBody = {
      name: name.trim(),
      description: description.trim() || undefined,
      triggerEventType,
      triggerConditions:
        conditions.length > 0
          ? conditions
              .filter((c) => c.field.trim())
              .map((c) => ({
                field: c.field,
                operator: c.operator as NonNullable<CreateAutomationBody['triggerConditions']>[number]['operator'],
                value: c.value || undefined,
              }))
          : undefined,
      conditionLogic: conditions.length > 1 ? conditionLogic : undefined,
      actions: actions.map((a) => ({
        type: a.type as 'webhook' | 'send_message' | 'emit_event' | 'log' | 'call_agent',
        config: a.config,
      })),
      enabled: true,
    };

    try {
      await createAutomation.mutateAsync(body);
      onClose();
    } catch {
      // Error handled by mutation
    }
  };

  const canProceed = () => {
    if (step === 'trigger') return triggerEventType && name.trim();
    if (step === 'conditions') return true; // Conditions are optional
    if (step === 'actions') return actions.length > 0;
    return false;
  };

  const selectedEvent = EVENT_TYPES.find((e) => e.value === triggerEventType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="relative border-b">
          <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
          <CardTitle>{isEditing ? 'Edit Automation' : 'Create Automation'}</CardTitle>
          <CardDescription>
            {step === 'trigger' && 'Choose when this automation should run'}
            {step === 'conditions' && 'Add conditions to filter events (optional)'}
            {step === 'actions' && 'Define what actions to take'}
          </CardDescription>

          {/* Progress steps */}
          <div className="flex items-center gap-2 mt-4">
            {(['trigger', 'conditions', 'actions'] as const).map((s, i) => (
              <div key={s} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                    step === s
                      ? 'bg-primary text-primary-foreground'
                      : s === 'trigger' ||
                          (s === 'conditions' && triggerEventType) ||
                          (s === 'actions' && triggerEventType)
                        ? 'bg-muted hover:bg-accent'
                        : 'bg-muted text-muted-foreground cursor-not-allowed',
                  )}
                  disabled={s !== 'trigger' && !triggerEventType}
                >
                  {i + 1}
                </button>
                {i < 2 && <ArrowRight className="h-4 w-4 mx-2 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-auto p-6">
          {/* Step 1: Trigger */}
          {step === 'trigger' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Automation Name
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Forward messages to agent"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium">
                  Description <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this automation do?"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Trigger Event</p>
                <div className="grid gap-2">
                  {EVENT_TYPES.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() => setTriggerEventType(event.value)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        triggerEventType === event.value
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-muted-foreground/50 hover:bg-accent',
                      )}
                    >
                      <Zap
                        className={cn(
                          'h-5 w-5',
                          triggerEventType === event.value ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <div className="flex-1">
                        <p className="font-medium">{event.label}</p>
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                      </div>
                      {triggerEventType === event.value && <Check className="h-5 w-5 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Conditions */}
          {step === 'conditions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Filter events by adding conditions. Leave empty to match all {selectedEvent?.label || 'events'}.
                </p>
                <Button variant="outline" size="sm" onClick={handleAddCondition}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Condition
                </Button>
              </div>

              {conditions.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Match</span>
                  <select
                    value={conditionLogic}
                    onChange={(e) => setConditionLogic(e.target.value as 'and' | 'or')}
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    <option value="and">ALL conditions (AND)</option>
                    <option value="or">ANY condition (OR)</option>
                  </select>
                </div>
              )}

              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <div key={condition.id} className="flex items-center gap-2 rounded-lg border p-3">
                    <Input
                      value={condition.field}
                      onChange={(e) => handleConditionChange(index, 'field', e.target.value)}
                      placeholder="payload.content"
                      className="flex-1 font-mono text-sm"
                    />
                    <select
                      value={condition.operator}
                      onChange={(e) => handleConditionChange(index, 'operator', e.target.value)}
                      className="rounded-md border bg-background px-2 py-2 text-sm"
                    >
                      {OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                    {!['exists', 'not_exists'].includes(condition.operator) && (
                      <Input
                        value={condition.value}
                        onChange={(e) => handleConditionChange(index, 'value', e.target.value)}
                        placeholder="value"
                        className="flex-1"
                      />
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveCondition(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {conditions.length === 0 && (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <p className="text-muted-foreground">
                      No conditions - automation will trigger on all matching events
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Actions */}
          {step === 'actions' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select one or more actions to perform when the automation triggers.
              </p>

              {/* Action types to add */}
              <div className="grid grid-cols-2 gap-2">
                {ACTION_TYPES.map((actionType) => {
                  const Icon = actionType.icon;
                  return (
                    <button
                      key={actionType.value}
                      type="button"
                      onClick={() => handleAddAction(actionType.value)}
                      className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent"
                    >
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">{actionType.label}</p>
                        <p className="text-xs text-muted-foreground">{actionType.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Added actions */}
              {actions.length > 0 && (
                <div className="space-y-3 mt-6">
                  <p className="text-sm font-medium">Configured Actions</p>
                  {actions.map((action, index) => {
                    const actionConfig = ACTION_TYPES.find((a) => a.value === action.type);
                    const Icon = actionConfig?.icon || Zap;
                    return (
                      <div key={action.id} className="rounded-lg border p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Icon className="h-5 w-5 text-primary" />
                            <span className="font-medium">{actionConfig?.label || action.type}</span>
                            <Badge variant="outline" className="text-[10px]">
                              #{index + 1}
                            </Badge>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => handleRemoveAction(index)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Action-specific config */}
                        {action.type === 'webhook' && (
                          <div className="space-y-2">
                            <Input
                              value={action.config.url || ''}
                              onChange={(e) => handleActionConfigChange(index, 'url', e.target.value)}
                              placeholder="https://webhook.example.com/..."
                            />
                            <select
                              value={action.config.method || 'POST'}
                              onChange={(e) => handleActionConfigChange(index, 'method', e.target.value)}
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            >
                              <option value="POST">POST</option>
                              <option value="GET">GET</option>
                              <option value="PUT">PUT</option>
                            </select>
                          </div>
                        )}

                        {action.type === 'send_message' && (
                          <div className="space-y-2">
                            <Input
                              value={action.config.content || ''}
                              onChange={(e) => handleActionConfigChange(index, 'content', e.target.value)}
                              placeholder="Message content (supports {{payload.field}} templates)"
                            />
                          </div>
                        )}

                        {action.type === 'call_agent' && (
                          <div className="space-y-2">
                            <Input
                              value={action.config.providerId || ''}
                              onChange={(e) => handleActionConfigChange(index, 'providerId', e.target.value)}
                              placeholder="Provider ID"
                            />
                            <Input
                              value={action.config.agentId || ''}
                              onChange={(e) => handleActionConfigChange(index, 'agentId', e.target.value)}
                              placeholder="Agent ID (optional)"
                            />
                          </div>
                        )}

                        {action.type === 'log' && (
                          <p className="text-sm text-muted-foreground">Event will be logged with full payload</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {actions.length === 0 && (
                <div className="rounded-lg border border-dashed p-8 text-center mt-4">
                  <p className="text-muted-foreground">Click an action type above to add it</p>
                </div>
              )}
            </div>
          )}
        </CardContent>

        {/* Footer */}
        <div className="border-t p-4 flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 'conditions') setStep('trigger');
              else if (step === 'actions') setStep('conditions');
              else onClose();
            }}
          >
            {step === 'trigger' ? 'Cancel' : 'Back'}
          </Button>

          {step !== 'actions' ? (
            <Button
              onClick={() => {
                if (step === 'trigger') setStep('conditions');
                else if (step === 'conditions') setStep('actions');
              }}
              disabled={!canProceed()}
            >
              Continue
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={!canProceed() || createAutomation.isPending}>
              {createAutomation.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Creating...
                </>
              ) : (
                'Create Automation'
              )}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
