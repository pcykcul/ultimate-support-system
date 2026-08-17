/** Shared types + formatting helpers for the reports pages. */

export interface Overview {
  range: { from: string; to: string };
  volume: { created: number; solved: number; open: number };
  byChannel: { channel: string; count: number }[];
  responseTimes: {
    /** Calendar minutes, not business hours — label it that way. */
    medianFirstResponseMin: number | null;
    medianResolutionMin: number | null;
  };
  sla: { achievedPct: number; breached: number };
  csat: { avg: number | null; count: number };
  perAgent: {
    agentId: string;
    name: string;
    replies: number;
    solved: number;
    medianFirstResponseMin: number | null;
  }[];
  byDay: { date: string; created: number; solved: number }[];
  deflection: { searches: number; zeroResults: number; ticketsCreated: number };
}

/**
 * Chart palette — CVD-validated pair for the created/solved series (adjacent-pair
 * ΔE well clear of the floors on the white card surface) plus a single-hue ordinal
 * ramp for the deflection funnel. Marks wear these colors; text never does.
 */
export const SERIES = {
  created: '#2a78d6', // blue
  solved: '#eb6834', // orange
} as const;

export const ORDINAL_BLUES = ['#86b6ef', '#2a78d6', '#1c5cab'] as const;

/** 95 → "1h 35m", 3000 → "2d 2h", null → "—". Whole minutes; no smoothing. */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function fmtCount(n: number): string {
  return n.toLocaleString();
}

/** "2026-08-12" → "Aug 12" (UTC, matching the server's UTC day buckets). */
export function fmtDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
