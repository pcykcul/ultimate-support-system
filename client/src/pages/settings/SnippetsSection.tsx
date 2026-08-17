/**
 * Snippets: reusable key/value content — {{snippet:key}} expands at render
 * time in articles and macros, so shared boilerplate is edited in one place.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/api/client';
import { useMe } from '@/lib/session';
import { Button, Card, EmptyState, Input } from '@/lib/ui';
import { ErrorNote, getOr, Loading } from './shared';

interface Snippet {
  id: string;
  key: string;
  value: string;
}

export default function SnippetsSection() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role != null && me.role !== 'collaborator';
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'snippets'],
    queryFn: () => getOr<{ items: Snippet[] }>('/api/kb/snippets', { items: [] }),
  });
  const snippets = data?.items ?? [];
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'snippets'] });

  const create = useMutation({
    mutationFn: () => api.post('/api/kb/snippets', { key: key.trim(), value: value.trim() }),
    onSuccess: () => {
      setKey('');
      setValue('');
      invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{'{{snippet:key}}'}</code> works in articles
        and macros — update the snippet once, every use updates.
      </p>

      {canEdit && (
        <Card className="p-4 flex items-end gap-2">
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-600 mb-1">Key</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="refund-policy" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Refunds are processed within 5 business days." />
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !key.trim() || !value.trim()}>
            <Plus size={15} /> Add
          </Button>
        </Card>
      )}
      <ErrorNote error={create.error} />

      <Card>
        {isLoading ? (
          <Loading />
        ) : snippets.length === 0 ? (
          <EmptyState title="No snippets" hint="Create one and reference it anywhere with {{snippet:key}}." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {snippets.map((s) => (
              <SnippetRow key={s.id} snippet={s} canEdit={canEdit} onChanged={invalidate} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SnippetRow({
  snippet,
  canEdit,
  onChanged,
}: {
  snippet: Snippet;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [value, setValue] = useState(snippet.value);
  const dirty = value !== snippet.value;

  const save = useMutation({
    mutationFn: () => api.patch(`/api/kb/snippets/${snippet.id}`, { value: value.trim() }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/kb/snippets/${snippet.id}`),
    onSuccess: onChanged,
  });

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <code className="w-44 shrink-0 truncate text-xs bg-gray-100 rounded px-1.5 py-1">{snippet.key}</code>
      <Input value={value} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} className="flex-1" />
      {canEdit && dirty && (
        <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending || !value.trim()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      )}
      {canEdit && (
        <Button
          variant="ghost"
          title="Delete snippet"
          onClick={() => {
            if (window.confirm(`Delete snippet "${snippet.key}"?`)) remove.mutate();
          }}
        >
          ✕
        </Button>
      )}
      <ErrorNote error={save.error ?? remove.error} />
    </li>
  );
}
