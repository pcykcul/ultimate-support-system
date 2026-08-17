/** Per-agent breakdown — sortable by clicking a column header. */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cx, EmptyState } from '@/lib/ui';
import { fmtMinutes, type Overview } from './shared';

type AgentRow = Overview['perAgent'][number];
type SortKey = 'name' | 'replies' | 'solved' | 'medianFirstResponseMin';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Agent', numeric: false },
  { key: 'replies', label: 'Public replies', numeric: true },
  { key: 'solved', label: 'Solved', numeric: true },
  { key: 'medianFirstResponseMin', label: 'Median first response', numeric: true },
];

export function AgentTable({ rows }: { rows: AgentRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('replies');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else {
        // null medians (no first replies attributed) always sort last, either direction
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) cmp = 0;
        else if (av == null) return 1;
        else if (bv == null) return -1;
        else cmp = av - bv;
      }
      return dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, dir]);

  const toggleSort = (key: SortKey, numeric: boolean) => {
    if (key === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDir(numeric ? 'desc' : 'asc'); // numbers start with the biggest, names A→Z
    }
  };

  if (rows.length === 0) {
    return <EmptyState title="No agent activity in this range" hint="Replies and solves will show up here." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={cx(
                  'py-2 px-3 text-[11px] uppercase tracking-wide font-medium text-gray-400',
                  col.numeric ? 'text-right' : 'text-left'
                )}
              >
                <button
                  onClick={() => toggleSort(col.key, col.numeric)}
                  className={cx(
                    'inline-flex items-center gap-0.5 hover:text-gray-600',
                    sortKey === col.key && 'text-gray-600'
                  )}
                >
                  {col.label}
                  {sortKey === col.key &&
                    (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.agentId} className="border-b border-gray-50 last:border-b-0">
              <td className="py-2 px-3 text-gray-800 font-medium">{r.name}</td>
              <td className="py-2 px-3 text-right text-gray-700 tabular-nums">{r.replies.toLocaleString()}</td>
              <td className="py-2 px-3 text-right text-gray-700 tabular-nums">{r.solved.toLocaleString()}</td>
              <td className="py-2 px-3 text-right text-gray-700 tabular-nums">
                {fmtMinutes(r.medianFirstResponseMin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
