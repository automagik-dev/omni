/**
 * WhatsApp HSM templates list + builder shell.
 *
 * Designed to plug into `InstanceDetail`'s Tabs as a new tab visible only
 * when the instance's channel is `whatsapp-business`. Lists templates with
 * filters (status / category / language), provides a "Sync from Meta"
 * action, and surfaces a builder dialog for creating new templates.
 *
 * Backend routes (Group 6 of the wish — being implemented in parallel):
 *   GET    /api/v2/instances/:id/whatsapp-templates?status=&category=&language=&sync=true
 *   DELETE /api/v2/instances/:id/whatsapp-templates/:templateId
 *
 * TODO: switch to `omni.templates.*` after make sdk-generate.
 */

import { TemplateBuilder } from '@/components/templates/TemplateBuilder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toaster';
import { apiFetch } from '@/lib/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Local types — these mirror the row shape returned by GET /whatsapp-templates.
// Once the SDK regenerates, swap for `WhatsappTemplate` from @omni/sdk.
// ---------------------------------------------------------------------------

type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DELETED';
type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

interface TemplateRow {
  id: string;
  metaId?: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  qualityScore?: string | null;
  rejectionReason?: string | null;
}

interface TemplatesResponse {
  templates: TemplateRow[];
  count: number;
}

// ---------------------------------------------------------------------------
// Hooks (local since SDK doesn't have these yet)
// ---------------------------------------------------------------------------

interface TemplateFilters {
  status?: TemplateStatus | '';
  category?: TemplateCategory | '';
  language?: string;
}

function useTemplatesList(instanceId: string, filters: TemplateFilters, sync = false) {
  return useQuery({
    queryKey: ['whatsapp-templates', instanceId, filters, sync],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.category) params.set('category', filters.category);
      if (filters.language) params.set('language', filters.language);
      if (sync) params.set('sync', 'true');
      const qs = params.toString();
      // TODO: switch to omni.templates.list(instanceId, filters) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-templates${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`List templates failed: ${res.status}`);
      return (await res.json()) as TemplatesResponse;
    },
  });
}

function useDeleteTemplate(instanceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      // TODO: switch to omni.templates.delete(...) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-templates/${templateId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Delete failed: ${res.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', instanceId] });
    },
  });
}

// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<TemplateStatus, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  PAUSED: 'warning',
  DELETED: 'secondary',
};

interface TemplatesTabProps {
  instanceId: string;
}

export function TemplatesTab({ instanceId }: TemplatesTabProps) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TemplateFilters>({ status: '', category: '', language: '' });
  const [showBuilder, setShowBuilder] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, error, refetch } = useTemplatesList(instanceId, filters);
  const deleteMutation = useDeleteTemplate(instanceId);

  const templates = useMemo(() => data?.templates ?? [], [data]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.category) params.set('category', filters.category);
      if (filters.language) params.set('language', filters.language);
      params.set('sync', 'true');
      // TODO: switch to omni.templates.list(..., { sync: true }) after make sdk-generate
      const res = await apiFetch(`/instances/${instanceId}/whatsapp-templates?${params.toString()}`);
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', instanceId] });
      toast.success('Synced from Meta');
    } catch (err) {
      toast.error(`Failed to sync: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (template: TemplateRow) => {
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    try {
      await deleteMutation.mutateAsync(template.id);
      toast.success(`Deleted "${template.name}"`);
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>Message Templates</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={syncing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              Sync from Meta
            </Button>
            <Button size="sm" onClick={() => setShowBuilder(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="tpl-filter-status" className="text-xs font-medium">
              Status
            </label>
            <select
              id="tpl-filter-status"
              value={filters.status ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as TemplateStatus | '' }))}
              className="flex h-9 w-full rounded-md border border-input bg-input/50 px-2 text-sm"
            >
              <option value="">All</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Pending</option>
              <option value="REJECTED">Rejected</option>
              <option value="PAUSED">Paused</option>
              <option value="DELETED">Deleted</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-filter-category" className="text-xs font-medium">
              Category
            </label>
            <select
              id="tpl-filter-category"
              value={filters.category ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value as TemplateCategory | '' }))}
              className="flex h-9 w-full rounded-md border border-input bg-input/50 px-2 text-sm"
            >
              <option value="">All</option>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-filter-lang" className="text-xs font-medium">
              Language
            </label>
            <select
              id="tpl-filter-lang"
              value={filters.language ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, language: e.target.value }))}
              className="flex h-9 w-full rounded-md border border-input bg-input/50 px-2 text-sm"
            >
              <option value="">All</option>
              <option value="pt_BR">Portuguese (BR)</option>
              <option value="en_US">English (US)</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load templates'}
            <Button variant="outline" size="sm" className="ml-2" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No templates yet. Create one or sync from Meta.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Language</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Quality</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => (
                  <tr key={tpl.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{tpl.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{tpl.language}</td>
                    <td className="px-3 py-2">{tpl.category}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[tpl.status] ?? 'secondary'}>{tpl.status}</Badge>
                      {tpl.rejectionReason && <p className="mt-0.5 text-xs text-destructive">{tpl.rejectionReason}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{tpl.qualityScore ?? '-'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(tpl)}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete ${tpl.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <p className="text-xs text-muted-foreground">{data.count} template(s)</p>}
      </CardContent>

      {/* Builder dialog */}
      <Dialog open={showBuilder} onOpenChange={(open) => !open && setShowBuilder(false)}>
        <DialogContent className="max-w-4xl overflow-y-auto sm:max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
            <DialogDescription>Submit a HSM template for Meta review. Approval can take up to 24h.</DialogDescription>
          </DialogHeader>
          <TemplateBuilder
            instanceId={instanceId}
            onCreated={() => {
              setShowBuilder(false);
              queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', instanceId] });
              toast.success('Template submitted for review');
            }}
            onCancel={() => setShowBuilder(false)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
