/**
 * Merge modal: type a source ticket number, resolve it via the list search,
 * confirm, then POST /api/tickets/:id/merge. The source is closed server-side.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge } from 'lucide-react';
import { api } from '@/api/client';
import { Button, Input, Modal, timeAgo } from '@/lib/ui';
import type { TicketListItem } from './shared';

export default function MergeModal({
  open,
  onClose,
  targetId,
  targetNumber,
}: {
  open: boolean;
  onClose: () => void;
  targetId: string;
  targetNumber: number;
}) {
  const qc = useQueryClient();
  const [numberInput, setNumberInput] = useState('');
  const [found, setFound] = useState<TicketListItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNumberInput('');
    setFound(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const find = async () => {
    const n = Number(numberInput.trim().replace(/^#/, ''));
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a ticket number, e.g. 1042');
      return;
    }
    setSearching(true);
    setError(null);
    setFound(null);
    try {
      const res = await api.get<{ items: TicketListItem[] }>(
        `/api/tickets?q=${encodeURIComponent(String(n))}&limit=50`
      );
      const match = res.items.find((t) => t.number === n);
      if (!match) setError(`No ticket #${n} found`);
      else if (match.id === targetId) setError('A ticket cannot be merged into itself');
      else setFound(match);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const merge = useMutation({
    mutationFn: (sourceTicketId: string) =>
      api.post(`/api/tickets/${targetId}/merge`, { sourceTicketId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ticket', targetId] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      close();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Merge failed'),
  });

  return (
    <Modal open={open} onClose={close} title={`Merge into #${targetNumber}`}>
      <p className="text-sm text-gray-500 mb-3">
        The source ticket's messages move into this ticket as internal notes, and the source is
        closed with an audit trail.
      </p>
      <div className="flex gap-2">
        <Input
          value={numberInput}
          onChange={(e) => {
            setNumberInput(e.target.value);
            setFound(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void find();
          }}
          placeholder="Source ticket number, e.g. 1042"
        />
        <Button variant="secondary" onClick={() => void find()} disabled={searching}>
          {searching ? 'Finding…' : 'Find'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {found && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="text-sm font-medium">
            <span className="font-mono text-gray-400">#{found.number}</span> {found.subject}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {found.requester.name} · updated {timeAgo(found.updatedAt)}
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!found || merge.isPending} onClick={() => found && merge.mutate(found.id)}>
          <GitMerge size={14} />
          {merge.isPending ? 'Merging…' : `Merge #${found?.number ?? '…'} into #${targetNumber}`}
        </Button>
      </div>
    </Modal>
  );
}
