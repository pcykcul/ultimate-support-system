/**
 * Reporting overview. Honest numbers only: medians over calendar time (labeled as such),
 * zero days kept in the chart, no vanity smoothing anywhere.
 */
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, cx, EmptyState, Input, PageHeader } from '@/lib/ui';
import { useMe } from '@/lib/session';
import { AgentTable } from './AgentTable';
import { ByChannelBars, ByDayChart } from './charts';
import { DeflectionCard } from './DeflectionCard';
import { fmtMinutes, type Overview } from './shared';

const PRESETS = [7, 30, 90] as const;

/** UTC day string, matching the server's UTC day buckets. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(days: number): { from: string; to: string } {
  const now = new Date();
  return {
    from: isoDay(new Date(now.getTime() - (days - 1) * 86_400_000)),
    to: isoDay(now),
  };
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </Card>
  );
}

function Section({
  title,
  sub,
  children,
  className,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cx('p-4', className)}>
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {sub && <p className="text-xs text-gray-400 mt-0.5 mb-3">{sub}</p>}
      {!sub && <div className="mb-3" />}
      {children}
    </Card>
  );
}

export default function ReportsPage() {
  const { data: me } = useMe();
  const [{ from, to }, setRange] = useState(() => presetRange(30));
  const rangeValid = from !== '' && to !== '' && from <= to;

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    // Whole-day bounds so "to" includes the entire selected day.
    params.set('from', `${from}T00:00:00.000Z`);
    params.set('to', `${to}T23:59:59.999Z`);
    return params.toString();
  }, [from, to]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports', 'overview', from, to],
    queryFn: () => api.get<Overview>(`/api/reports/overview?${qs}`),
    enabled: rangeValid,
    placeholderData: keepPreviousData,
  });

  const seesEveryone = me?.role === 'admin' || me?.role === 'supervisor';

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="What actually happened — real counts and medians, no smoothing."
      />

      {/* Range picker: presets + custom dates */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white">
          {PRESETS.map((days) => {
            const p = presetRange(days);
            const active = from === p.from && to === p.to;
            return (
              <button
                key={days}
                onClick={() => setRange(p)}
                className={cx(
                  'px-3 py-1.5 text-sm font-medium border-r border-gray-200 last:border-r-0',
                  active ? 'bg-brand-soft text-brand' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {days} days
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
          <div className="w-36">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              aria-label="From date"
            />
          </div>
          <span>→</span>
          <div className="w-36">
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              aria-label="To date"
            />
          </div>
        </div>
      </div>

      {!rangeValid && (
        <Card className="p-6">
          <EmptyState title="Pick a valid range" hint="The start date must be on or before the end date." />
        </Card>
      )}
      {rangeValid && isLoading && (
        <Card className="p-6">
          <p className="py-8 text-center text-sm text-gray-400">Crunching the numbers…</p>
        </Card>
      )}
      {rangeValid && isError && (
        <Card className="p-6">
          <EmptyState
            title="Could not load the report"
            hint={error instanceof Error ? error.message : 'Try a different range.'}
          />
        </Card>
      )}

      {rangeValid && data && (
        <div className="space-y-4">
          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label="Open now" value={data.volume.open.toLocaleString()} sub="not range-bound" />
            <StatTile label="Created" value={data.volume.created.toLocaleString()} sub="in range" />
            <StatTile
              label="Solved"
              value={data.volume.solved.toLocaleString()}
              sub={
                data.responseTimes.medianResolutionMin != null
                  ? `median resolution ${fmtMinutes(data.responseTimes.medianResolutionMin)}`
                  : 'in range'
              }
            />
            <StatTile
              label="Median first response"
              value={fmtMinutes(data.responseTimes.medianFirstResponseMin)}
              sub="calendar time, not business hours"
            />
            <StatTile
              label="SLA achieved"
              value={`${data.sla.achievedPct}%`}
              sub={`${data.sla.breached.toLocaleString()} ticket${data.sla.breached === 1 ? '' : 's'} breached`}
            />
            <StatTile
              label="CSAT"
              value={data.csat.avg != null ? `${data.csat.avg} / 5` : '—'}
              sub={
                data.csat.count > 0
                  ? `${data.csat.count.toLocaleString()} response${data.csat.count === 1 ? '' : 's'}`
                  : 'no responses yet'
              }
            />
          </div>

          {/* Per-day volume */}
          <Section title="Tickets per day" sub="Created vs solved, every day in the range — zero days included.">
            {data.byDay.length === 0 ? (
              <EmptyState title="Nothing in this range" />
            ) : (
              <ByDayChart data={data.byDay} />
            )}
          </Section>

          {/* Channel mix + deflection */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="By channel" sub="Where tickets in this range came from.">
              {data.byChannel.length === 0 ? (
                <EmptyState title="No tickets created in this range" />
              ) : (
                <ByChannelBars data={data.byChannel} />
              )}
            </Section>
            <Section title="Deflection" sub="Did the knowledge base answer before a ticket was needed?">
              <DeflectionCard deflection={data.deflection} />
            </Section>
          </div>

          {/* Per-agent */}
          <Section
            title="Per agent"
            sub={
              seesEveryone
                ? 'Median first response is calendar time, over tickets each agent answered first.'
                : 'Your own numbers — supervisors and admins see the whole team.'
            }
          >
            <AgentTable rows={data.perAgent} />
          </Section>
        </div>
      )}
    </div>
  );
}
