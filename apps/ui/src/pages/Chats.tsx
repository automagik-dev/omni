import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useChats } from '@/hooks/useChats';
import { useInstances } from '@/hooks/useInstances';
import { formatRelativeTime, truncate } from '@/lib/utils';
import { MessageSquare, Search, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export function Chats() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const instanceId = searchParams.get('instanceId') ?? undefined;

  const { data: instances } = useInstances();
  const {
    data: chats,
    isLoading,
    error,
  } = useChats({
    instanceId,
    search: search || undefined,
    limit: 50,
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      if (search) {
        prev.set('search', search);
      } else {
        prev.delete('search');
      }
      return prev;
    });
  };

  const handleInstanceFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSearchParams((prev) => {
      if (e.target.value) {
        prev.set('instanceId', e.target.value);
      } else {
        prev.delete('instanceId');
      }
      return prev;
    });
  };

  return (
    <>
      <Header title="Chats" subtitle="View and manage conversations" />

      <div className="flex-1 overflow-auto p-6">
        {/* Filters */}
        <div className="mb-6 flex gap-4">
          <form onSubmit={handleSearchSubmit} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search chats..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </form>
          <select
            value={instanceId ?? ''}
            onChange={handleInstanceFilter}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All instances</option>
            {instances?.items.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>

        {/* Chat list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">Failed to load chats</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        ) : chats?.items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No chats found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {chats?.items.map((chat) => (
              <Link key={chat.id} to={`/chats/${chat.id}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      {chat.avatarUrl ? (
                        <img
                          src={chat.avatarUrl}
                          alt={chat.name ?? 'Chat'}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <User className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{chat.name ?? chat.externalId}</p>
                        <Badge variant="secondary" className="text-xs">
                          {chat.chatType}
                        </Badge>
                      </div>
                      {chat.description && (
                        <p className="text-sm text-muted-foreground truncate">{truncate(chat.description, 50)}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {chat.channel} · {formatRelativeTime(chat.updatedAt)}
                      </p>
                    </div>
                    {chat.isArchived && <Badge variant="outline">Archived</Badge>}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
