/**
 * Cmd+K command palette: navigation + ticket/article search in one box.
 * Keyboard-first is a founding constraint, not a retrofit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { cx } from '../lib/ui';

interface SearchResult {
  type: 'ticket' | 'article' | 'sop';
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

const NAV_COMMANDS: SearchResult[] = [
  { type: 'sop', id: 'nav-inbox', title: 'Go to Inbox', url: '/inbox' },
  { type: 'sop', id: 'nav-kb', title: 'Go to Knowledge Base', url: '/kb' },
  { type: 'sop', id: 'nav-sops', title: 'Go to SOPs', url: '/sops' },
  { type: 'sop', id: 'nav-reports', title: 'Go to Reports', url: '/reports' },
  { type: 'sop', id: 'nav-settings', title: 'Go to Settings', url: '/settings' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setSelected(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const { data: remote } = useQuery({
    queryKey: ['palette', query],
    queryFn: () => api.get<SearchResult[]>(`/api/tickets/palette-search?q=${encodeURIComponent(query)}`),
    enabled: open && query.trim().length >= 2,
    staleTime: 10_000,
  });

  const results = useMemo(() => {
    const nav = NAV_COMMANDS.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
    return [...(remote ?? []), ...nav].slice(0, 10);
  }, [remote, query]);

  const go = (r: SearchResult) => {
    setOpen(false);
    navigate(r.url);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, results.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            }
            if (e.key === 'Enter' && results[selected]) go(results[selected]);
          }}
          placeholder="Search tickets, articles, SOPs… or jump anywhere"
          className="w-full px-4 py-3 text-sm border-b border-gray-100 focus:outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.map((r, i) => (
            <li key={`${r.type}-${r.id}`}>
              <button
                className={cx(
                  'w-full text-left px-4 py-2 text-sm flex items-center justify-between',
                  i === selected ? 'bg-brand-soft text-brand' : 'hover:bg-gray-50'
                )}
                onMouseEnter={() => setSelected(i)}
                onClick={() => go(r)}
              >
                <span className="truncate">{r.title}</span>
                {r.subtitle && <span className="text-xs text-gray-400 ml-2 shrink-0">{r.subtitle}</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">No matches</li>}
        </ul>
        <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
