import { ContactCard } from '@/components/contacts';
import { Header } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useInfiniteContacts } from '@/hooks/useContacts';
import { useInstances } from '@/hooks/useInstances';
import { cn } from '@/lib/utils';
import type { Contact } from '@omni/sdk';
import { BookUser, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Contacts page showing contacts from channel instances
 */
export function Contacts() {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const { data: instances, isLoading: loadingInstances } = useInstances();

  // Set first active instance as default
  useEffect(() => {
    if (instances?.items && instances.items.length > 0 && !selectedInstanceId) {
      const active = instances.items.find((i) => i.isActive);
      setSelectedInstanceId(active?.id ?? instances.items[0].id);
    }
  }, [instances, selectedInstanceId]);

  const {
    data: contactsData,
    isLoading: loadingContacts,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteContacts(selectedInstanceId ?? undefined, { limit: 50 });

  // Flatten contacts from all pages
  const contacts = useMemo<Contact[]>(() => {
    if (!contactsData) return [];
    return contactsData.pages.flatMap((page) => page.items);
  }, [contactsData]);

  // Infinite scroll observer
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loadingContacts || isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) {
          fetchNextPage();
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [loadingContacts, isFetchingNextPage, hasNextPage, fetchNextPage],
  );

  return (
    <>
      <Header title="Contacts" subtitle="View contacts from channel instances" />

      <div className="flex flex-1 overflow-hidden">
        {/* Instance Selector Sidebar */}
        <div className="w-64 shrink-0 border-r bg-card">
          <div className="p-4">
            <h3 className="text-sm font-medium text-muted-foreground">Select Instance</h3>
          </div>
          <div className="space-y-1 px-2">
            {loadingInstances ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : instances?.items.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">No instances available</p>
            ) : (
              instances?.items.map((instance) => (
                <button
                  key={instance.id}
                  type="button"
                  onClick={() => setSelectedInstanceId(instance.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selectedInstanceId === instance.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  <Server className="h-4 w-4 shrink-0" />
                  <span className="truncate">{instance.name}</span>
                  <div
                    className={cn(
                      'ml-auto h-2 w-2 shrink-0 rounded-full',
                      instance.isActive ? 'bg-green-500' : 'bg-muted-foreground',
                    )}
                  />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Contacts List */}
        <div className="flex-1 overflow-auto p-6">
          {!selectedInstanceId ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <BookUser className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="mt-4 text-muted-foreground">Select an instance to view contacts</p>
            </div>
          ) : loadingContacts ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : contacts.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookUser className="h-5 w-5" />
                  No Contacts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  No contacts found for this instance. Contacts will appear here once the instance syncs with the
                  channel.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{contacts.length} contacts loaded</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {contacts.map((contact) => (
                  <ContactCard key={contact.platformUserId} contact={contact} />
                ))}
              </div>

              {/* Load more trigger */}
              {hasNextPage && (
                <div ref={loadMoreRef} className="flex justify-center py-8">
                  {isFetchingNextPage ? (
                    <Spinner />
                  ) : (
                    <Button variant="outline" onClick={() => fetchNextPage()}>
                      Load More
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
