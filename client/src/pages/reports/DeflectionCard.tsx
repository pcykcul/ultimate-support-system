/**
 * Deflection funnel: help-center searches → zero-result searches → tickets created.
 * The point is the insight, not the decoration — zero-result searches are the
 * content team's writing queue, so this links straight to KB health.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, PenLine } from 'lucide-react';
import { ORDINAL_BLUES, type Overview } from './shared';

export function DeflectionCard({ deflection }: { deflection: Overview['deflection'] }) {
  const stages = [
    { label: 'KB searches', value: deflection.searches, color: ORDINAL_BLUES[0] },
    { label: 'Zero-result searches', value: deflection.zeroResults, color: ORDINAL_BLUES[1] },
    { label: 'Tickets created', value: deflection.ticketsCreated, color: ORDINAL_BLUES[2] },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div>
      <div className="space-y-3">
        {stages.map((s, i) => (
          <div key={s.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-500 inline-flex items-center gap-1">
                {i > 0 && <ArrowRight size={11} className="text-gray-300" aria-hidden />}
                {s.label}
              </span>
              <span className="text-gray-700 font-medium tabular-nums">{s.value.toLocaleString()}</span>
            </div>
            <div
              className="h-4 rounded bg-gray-100 overflow-hidden"
              title={`${s.label}: ${s.value.toLocaleString()}`}
            >
              <div
                className="h-full rounded"
                style={{ width: `${Math.max((s.value / max) * 100, 1.5)}%`, background: s.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-gray-500 flex items-start gap-1.5">
        <PenLine size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
        <span>
          Every zero-result search is an article waiting to be written.{' '}
          <Link to="/kb/health" className="text-brand font-medium hover:underline">
            See the queries →
          </Link>
        </span>
      </p>
    </div>
  );
}
