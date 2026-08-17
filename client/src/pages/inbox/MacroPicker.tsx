/** Dropdown listing macros; picking one lets the parent apply it to the ticket. */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wand2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/lib/ui';
import type { MacroItem } from './shared';

export default function MacroPicker({
  onPick,
  disabled,
}: {
  onPick: (macro: MacroItem) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['macros'],
    queryFn: () => api.get<{ items: MacroItem[] }>('/api/tickets/macros'),
    staleTime: 60_000,
  });
  const macros = data?.items ?? [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} disabled={disabled}>
        <Wand2 size={14} />
        Macro
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-64 bg-white rounded-xl border border-gray-200 shadow-lg py-1 max-h-64 overflow-y-auto">
          {macros.map((m) => (
            <button
              key={m.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => {
                setOpen(false);
                onPick(m);
              }}
            >
              <span className="block font-medium truncate">{m.name}</span>
              <span className="block text-xs text-gray-400 truncate">{m.body}</span>
            </button>
          ))}
          {macros.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-400 text-center">No macros yet</p>
          )}
        </div>
      )}
    </div>
  );
}
