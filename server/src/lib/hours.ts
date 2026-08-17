/**
 * Business-hours math over IANA timezones, dependency-free (Intl API).
 *
 * Design rules (docs/research/08-business-hours-sla.md):
 * - All instants are UTC Dates; schedules carry an IANA zone. DST shifts are automatic
 *   because every wall-clock conversion goes through Intl with the schedule's zone.
 * - A schedule with no intervals is treated as 24/7.
 * - Holidays are local dates ('YYYY-MM-DD' in the schedule's zone); the whole day is closed.
 */

export interface ScheduleInterval {
  weekday: number; // 0=Sunday .. 6=Saturday (local)
  startMinute: number; // minutes since local midnight, inclusive
  endMinute: number; // exclusive
}

export interface BusinessSchedule {
  timezone: string; // IANA
  intervals: ScheduleInterval[];
  holidays: Set<string>; // 'YYYY-MM-DD' local dates
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Sunday..6=Saturday
  minuteOfDay: number;
  dateKey: string; // 'YYYY-MM-DD'
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    fmtCache.set(timezone, fmt);
  }
  return fmt;
}

/** Local wall-clock parts for a UTC instant in a zone. */
export function localParts(date: Date, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some ICU versions render midnight as 24
  const minute = Number(get('minute'));
  const weekday = WEEKDAYS.indexOf(get('weekday'));
  return {
    year,
    month,
    day,
    weekday,
    minuteOfDay: hour * 60 + minute,
    dateKey: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
      .toString()
      .padStart(2, '0')}`,
  };
}

/** UTC offset (ms) of a zone at a given instant. */
function offsetAt(date: Date, timezone: string): number {
  const p = localParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minuteOfDay / 60), p.minuteOfDay % 60, 0);
  // Round to the minute to ignore the seconds component we dropped.
  const dateMinute = Math.floor(date.getTime() / 60000) * 60000;
  return asUtc - dateMinute;
}

/** Convert a local wall-clock time in a zone to a UTC instant (DST-safe, two-pass). */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  minuteOfDay: number,
  timezone: string
): Date {
  const guessUtc = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0);
  let ts = guessUtc - offsetAt(new Date(guessUtc), timezone);
  // Second pass corrects instants that landed on the other side of a DST transition.
  ts = guessUtc - offsetAt(new Date(ts), timezone);
  return new Date(ts);
}

function intervalsFor(schedule: BusinessSchedule, weekday: number): ScheduleInterval[] {
  return schedule.intervals
    .filter((i) => i.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
}

function is247(schedule: BusinessSchedule): boolean {
  return schedule.intervals.length === 0;
}

/** Is the instant inside working hours? */
export function isOpen(date: Date, schedule: BusinessSchedule): boolean {
  if (is247(schedule)) return true;
  const p = localParts(date, schedule.timezone);
  if (schedule.holidays.has(p.dateKey)) return false;
  return intervalsFor(schedule, p.weekday).some(
    (i) => p.minuteOfDay >= i.startMinute && p.minuteOfDay < i.endMinute
  );
}

/** First open instant at or after `date`. Returns `date` when already open. */
export function nextOpenTime(date: Date, schedule: BusinessSchedule): Date {
  if (is247(schedule)) return date;
  let cursor = new Date(Math.ceil(date.getTime() / 60000) * 60000); // minute-align
  for (let guard = 0; guard < 400; guard++) {
    const p = localParts(cursor, schedule.timezone);
    if (!schedule.holidays.has(p.dateKey)) {
      for (const i of intervalsFor(schedule, p.weekday)) {
        if (p.minuteOfDay < i.startMinute) {
          return zonedTimeToUtc(p.year, p.month, p.day, i.startMinute, schedule.timezone);
        }
        if (p.minuteOfDay >= i.startMinute && p.minuteOfDay < i.endMinute) {
          return cursor;
        }
      }
    }
    // advance to next local midnight
    cursor = zonedTimeToUtc(p.year, p.month, p.day, 24 * 60, schedule.timezone);
  }
  return cursor; // schedule has intervals but none reachable — degenerate config
}

/** Add N business minutes to a start instant. */
export function addBusinessMinutes(start: Date, minutes: number, schedule: BusinessSchedule): Date {
  if (is247(schedule)) return new Date(start.getTime() + minutes * 60000);
  let remaining = minutes;
  let cursor = nextOpenTime(start, schedule);
  for (let guard = 0; guard < 800 && remaining > 0; guard++) {
    const p = localParts(cursor, schedule.timezone);
    if (!schedule.holidays.has(p.dateKey)) {
      for (const i of intervalsFor(schedule, p.weekday)) {
        if (p.minuteOfDay >= i.endMinute) continue;
        const from = Math.max(p.minuteOfDay, i.startMinute);
        const available = i.endMinute - from;
        if (available <= 0) continue;
        if (remaining <= available) {
          return zonedTimeToUtc(p.year, p.month, p.day, from + remaining, schedule.timezone);
        }
        remaining -= available;
      }
    }
    cursor = nextOpenTime(
      zonedTimeToUtc(p.year, p.month, p.day, 24 * 60, schedule.timezone),
      schedule
    );
  }
  return cursor;
}

/** Business minutes elapsed between two instants. */
export function businessMinutesBetween(start: Date, end: Date, schedule: BusinessSchedule): number {
  if (end <= start) return 0;
  if (is247(schedule)) return Math.floor((end.getTime() - start.getTime()) / 60000);
  let total = 0;
  let cursor = nextOpenTime(start, schedule);
  for (let guard = 0; guard < 800 && cursor < end; guard++) {
    const p = localParts(cursor, schedule.timezone);
    if (!schedule.holidays.has(p.dateKey)) {
      for (const i of intervalsFor(schedule, p.weekday)) {
        const from = Math.max(p.minuteOfDay, i.startMinute);
        if (from >= i.endMinute) continue;
        const intervalStartUtc = zonedTimeToUtc(p.year, p.month, p.day, from, schedule.timezone);
        const intervalEndUtc = zonedTimeToUtc(p.year, p.month, p.day, i.endMinute, schedule.timezone);
        if (intervalStartUtc >= end) break;
        const sliceEnd = intervalEndUtc < end ? intervalEndUtc : end;
        if (sliceEnd > intervalStartUtc) {
          total += Math.floor((sliceEnd.getTime() - intervalStartUtc.getTime()) / 60000);
        }
      }
    }
    cursor = nextOpenTime(
      zonedTimeToUtc(p.year, p.month, p.day, 24 * 60, schedule.timezone),
      schedule
    );
  }
  return total;
}

/** Human string for "the customer's local clock": e.g. "3:42 PM Tue · Sydney". */
export function formatLocalClock(date: Date, timezone: string): { label: string; isDaytime: boolean; isBusinessHoursGuess: boolean } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
    hour12: true,
  });
  const p = localParts(date, timezone);
  const hour = Math.floor(p.minuteOfDay / 60);
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
  return {
    label: `${fmt.format(date)} · ${city}`,
    isDaytime: hour >= 7 && hour < 21,
    isBusinessHoursGuess: p.weekday >= 1 && p.weekday <= 5 && hour >= 9 && hour < 17,
  };
}
