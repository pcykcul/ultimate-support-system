/**
 * Synonyms: term groups that classic IR search expands — searching any term in
 * a group also finds the others. This is the honest, no-model way to make
 * search feel smart.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/api/client';
import { useMe } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input } from '@/lib/ui';
import { ErrorNote, fromCsv, getOr, Loading } from './shared';

interface SynonymGroup {
  id: string;
  terms: string[];
}

export default function SynonymsSection() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role != null && me.role !== 'collaborator';
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'synonyms'],
    queryFn: () => getOr<{ items: SynonymGroup[] }>('/api/settings/synonyms', { items: [] }),
  });
  const groups = data?.items ?? [];
  const [input, setInput] = useState('');

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'synonyms'] });

  const create = useMutation({
    mutationFn: () => api.post('/api/settings/synonyms', { terms: fromCsv(input) }),
    onSuccess: () => {
      setInput('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/settings/synonyms/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Searching any term in a group also finds the others — e.g. "invoice, bill, receipt".
      </p>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="invoice, bill, receipt"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && fromCsv(input).length >= 2) create.mutate();
            }}
          />
          <Button onClick={() => create.mutate()} disabled={create.isPending || fromCsv(input).length < 2}>
            <Plus size={15} /> Add group
          </Button>
        </div>
      )}
      <ErrorNote error={create.error ?? remove.error} />

      <Card>
        {isLoading ? (
          <Loading />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No synonym groups"
            hint="Add comma-separated terms that should find each other in search."
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5 flex-1">
                  {g.terms.map((t) => (
                    <Badge key={t} color="brand">
                      {t}
                    </Badge>
                  ))}
                </div>
                {canEdit && (
                  <Button variant="ghost" title="Delete group" onClick={() => remove.mutate(g.id)}>
                    ✕
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
