import { Header } from '@/components/layout';
import { PersonCard, PersonDetailModal } from '@/components/persons';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { usePersons } from '@/hooks/usePersons';
import { Search, Users } from 'lucide-react';
import { useState } from 'react';

/**
 * Persons (Users) management page
 */
export function Persons() {
  const [search, setSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const { data: persons, isLoading, isFetching } = usePersons({ search, limit: 50 });

  return (
    <>
      <Header title="People" subtitle="Search and manage user identities" />

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
              {persons?.map((person) => (
                <PersonCard key={person.id} person={person} onClick={() => setSelectedPersonId(person.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <PersonDetailModal personId={selectedPersonId} onClose={() => setSelectedPersonId(null)} />
    </>
  );
}
