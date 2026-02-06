import { Header } from '@/components/layout';
import { PersonCard, PersonDetailModal } from '@/components/persons';
import { Badge } from '@/components/ui/badge';
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
import { Spinner } from '@/components/ui/spinner';
import { useMergePersons, usePersons } from '@/hooks/usePersons';
import { cn } from '@/lib/utils';
import type { Person } from '@omni/sdk';
import { GitMerge, Search, Users, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Persons (Users) management page
 */
export function Persons() {
  const [search, setSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Person[]>([]);
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const { data: persons, isLoading, isFetching, refetch } = usePersons({ search, limit: 50 });
  const mergePersons = useMergePersons();

  const toggleMergeSelection = (person: Person) => {
    if (selectedForMerge.some((p) => p.id === person.id)) {
      setSelectedForMerge(selectedForMerge.filter((p) => p.id !== person.id));
    } else if (selectedForMerge.length < 2) {
      setSelectedForMerge([...selectedForMerge, person]);
    }
  };

  const handleMerge = async () => {
    if (selectedForMerge.length !== 2) return;

    try {
      await mergePersons.mutateAsync({
        sourcePersonId: selectedForMerge[0].id,
        targetPersonId: selectedForMerge[1].id,
        reason: 'Manual merge from UI',
      });
      setShowMergeDialog(false);
      setSelectedForMerge([]);
      setMergeMode(false);
      refetch();
    } catch {
      // Error handled by mutation
    }
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setSelectedForMerge([]);
  };

  return (
    <>
      <Header
        title="People"
        subtitle="Search and manage user identities"
        actions={
          mergeMode ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{selectedForMerge.length}/2 selected</Badge>
              <Button
                variant="default"
                size="sm"
                disabled={selectedForMerge.length !== 2}
                onClick={() => setShowMergeDialog(true)}
              >
                <GitMerge className="mr-2 h-4 w-4" />
                Merge
              </Button>
              <Button variant="outline" size="sm" onClick={cancelMerge}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setMergeMode(true)}>
              <GitMerge className="mr-2 h-4 w-4" />
              Merge People
            </Button>
          )
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Enter at least 2 characters to search</p>
        </div>

        {/* Results */}
        {search.length < 2 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="mt-4 text-muted-foreground">Search for people by name, email, or phone number</p>
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : persons?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-muted-foreground">No people found matching "{search}"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {isFetching && !isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size="sm" />
                <span>Searching...</span>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {persons?.map((person) => {
                const isSelectedForMerge = selectedForMerge.some((p) => p.id === person.id);
                return (
                  <div
                    key={person.id}
                    role={mergeMode ? 'button' : undefined}
                    tabIndex={mergeMode ? 0 : undefined}
                    className={cn(
                      'relative',
                      mergeMode && 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring',
                      isSelectedForMerge && 'ring-2 ring-primary rounded-lg',
                    )}
                    onClick={mergeMode ? () => toggleMergeSelection(person) : undefined}
                    onKeyDown={
                      mergeMode
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleMergeSelection(person);
                            }
                          }
                        : undefined
                    }
                  >
                    {isSelectedForMerge && (
                      <div className="absolute -top-2 -right-2 z-10 h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                        {selectedForMerge.findIndex((p) => p.id === person.id) + 1}
                      </div>
                    )}
                    <PersonCard
                      person={person}
                      onClick={mergeMode ? undefined : () => setSelectedPersonId(person.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <PersonDetailModal personId={selectedPersonId} onClose={() => setSelectedPersonId(null)} />

      {/* Merge Confirmation Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge People</DialogTitle>
            <DialogDescription>
              This will merge two person records into one. All identities from the first person will be moved to the
              second.
            </DialogDescription>
          </DialogHeader>

          {selectedForMerge.length === 2 && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 rounded-lg border p-3 bg-destructive/5 border-destructive/20">
                  <p className="text-xs text-muted-foreground mb-1">Will be deleted</p>
                  <p className="font-medium">{selectedForMerge[0].displayName || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground font-mono">{selectedForMerge[0].id}</p>
                </div>
                <GitMerge className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 rounded-lg border p-3 bg-primary/5 border-primary/20">
                  <p className="text-xs text-muted-foreground mb-1">Will be kept</p>
                  <p className="font-medium">{selectedForMerge[1].displayName || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground font-mono">{selectedForMerge[1].id}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                All identities and data from &quot;{selectedForMerge[0].displayName || 'Unknown'}&quot; will be
                transferred to &quot;{selectedForMerge[1].displayName || 'Unknown'}&quot;.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMergeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={mergePersons.isPending}>
              {mergePersons.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Merging...
                </>
              ) : (
                <>
                  <GitMerge className="mr-2 h-4 w-4" />
                  Confirm Merge
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
