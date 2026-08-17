/**
 * Unit tests for the business-hours engine (lib/hours.ts).
 *
 * Offset cheat sheet used throughout (all expectations are built with explicit
 * Date.UTC arithmetic — never with the code under test):
 *
 * Australia/Sydney
 *   AEST = UTC+10 (southern winter: after the first Sunday in April,
 *                  before the first Sunday in October)
 *   AEDT = UTC+11 (southern summer)
 *   2026 transitions:
 *     - DST ENDS   Sun 2026-04-05: 03:00 AEDT -> 02:00 AEST (clocks back, +11 -> +10)
 *     - DST STARTS Sun 2026-10-04: 02:00 AEST -> 03:00 AEDT (clocks forward, +10 -> +11)
 *   So: local wall clock in AEST maps to UTC by subtracting 10h; in AEDT by subtracting 11h.
 *
 * Europe/London
 *   GMT = UTC+0, BST = UTC+1
 *   2026: BST starts Sun 2026-03-29 01:00 GMT -> 02:00 BST; ends Sun 2026-10-25.
 *
 * Weekday anchors (2026-01-01 was a Thursday):
 *   Mon 2026-08-17 .. Fri 2026-08-21, Sat 2026-08-22, Sun 2026-08-23, Mon 2026-08-24
 *   (all in Sydney winter, AEST +10)
 *   Thu 2026-10-01, Fri 2026-10-02, Sat 2026-10-03, Sun 2026-10-04 (DST start), Mon 2026-10-05
 *   Wed 2026-04-01, Sat 2026-04-04, Sun 2026-04-05 (DST end), Mon 2026-04-06
 */
import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  formatLocalClock,
  isOpen,
  localParts,
  nextOpenTime,
  zonedTimeToUtc,
  type BusinessSchedule,
} from './hours.js';

const SYDNEY = 'Australia/Sydney';
const LONDON = 'Europe/London';

/** Mon-Fri 09:00-17:30 in Sydney (540..1050 minutes) — 510 open minutes per day. */
function sydneySchedule(holidays: string[] = []): BusinessSchedule {
  return {
    timezone: SYDNEY,
    intervals: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: 9 * 60, // 09:00
      endMinute: 17 * 60 + 30, // 17:30 (exclusive)
    })),
    holidays: new Set(holidays),
  };
}

/** Empty intervals = 24/7 by design. */
function alwaysOpen(): BusinessSchedule {
  return { timezone: SYDNEY, intervals: [], holidays: new Set() };
}

describe('localParts', () => {
  // One shared instant: 2026-08-17T00:00:00Z.
  const instant = new Date(Date.UTC(2026, 7, 17, 0, 0, 0));

  it('resolves Sydney winter time (AEST, UTC+10)', () => {
    // 00:00 UTC + 10h = Mon 2026-08-17 10:00 AEST.
    const p = localParts(instant, SYDNEY);
    expect(p).toEqual({
      year: 2026,
      month: 8,
      day: 17,
      weekday: 1, // Monday
      minuteOfDay: 10 * 60,
      dateKey: '2026-08-17',
    });
  });

  it('resolves London summer time (BST, UTC+1)', () => {
    // 00:00 UTC + 1h = Mon 2026-08-17 01:00 BST.
    const p = localParts(instant, LONDON);
    expect(p).toEqual({
      year: 2026,
      month: 8,
      day: 17,
      weekday: 1,
      minuteOfDay: 60,
      dateKey: '2026-08-17',
    });
  });

  it('crosses the date line backwards for a negative offset zone', () => {
    // New York in August is EDT (UTC-4): 00:00 UTC - 4h = Sun 2026-08-16 20:00.
    const p = localParts(instant, 'America/New_York');
    expect(p).toEqual({
      year: 2026,
      month: 8,
      day: 16,
      weekday: 0, // Sunday — previous local day
      minuteOfDay: 20 * 60,
      dateKey: '2026-08-16',
    });
  });

  it('resolves London winter time (GMT, UTC+0) late in the local day', () => {
    // Thu 2026-01-15 23:30 UTC == 23:30 GMT (no DST in January).
    const p = localParts(new Date(Date.UTC(2026, 0, 15, 23, 30, 0)), LONDON);
    expect(p).toEqual({
      year: 2026,
      month: 1,
      day: 15,
      weekday: 4, // Thursday
      minuteOfDay: 23 * 60 + 30,
      dateKey: '2026-01-15',
    });
  });
});

describe('zonedTimeToUtc', () => {
  describe('Australia/Sydney around the April 2026 DST end (+11 -> +10 on Sun Apr 5)', () => {
    it('Sat 2026-04-04 12:00 local is still AEDT (+11)', () => {
      // 12:00 - 11h = 01:00 UTC same day.
      expect(zonedTimeToUtc(2026, 4, 4, 12 * 60, SYDNEY).getTime()).toBe(
        Date.UTC(2026, 3, 4, 1, 0, 0)
      );
    });

    it('Sun 2026-04-05 12:00 local (after the 03:00->02:00 fallback) is AEST (+10)', () => {
      // 12:00 - 10h = 02:00 UTC same day.
      expect(zonedTimeToUtc(2026, 4, 5, 12 * 60, SYDNEY).getTime()).toBe(
        Date.UTC(2026, 3, 5, 2, 0, 0)
      );
    });

    it('Mon 2026-04-06 12:00 local is AEST (+10)', () => {
      expect(zonedTimeToUtc(2026, 4, 6, 12 * 60, SYDNEY).getTime()).toBe(
        Date.UTC(2026, 3, 6, 2, 0, 0)
      );
    });
  });

  describe('Australia/Sydney around the October 2026 DST start (+10 -> +11 on Sun Oct 4)', () => {
    it('Sat 2026-10-03 12:00 local is AEST (+10)', () => {
      // 12:00 - 10h = 02:00 UTC same day.
      expect(zonedTimeToUtc(2026, 10, 3, 12 * 60, SYDNEY).getTime()).toBe(
        Date.UTC(2026, 9, 3, 2, 0, 0)
      );
    });

    it('Sun 2026-10-04 12:00 local (after the 02:00->03:00 spring-forward) is AEDT (+11)', () => {
      // 12:00 - 11h = 01:00 UTC same day.
      expect(zonedTimeToUtc(2026, 10, 4, 12 * 60, SYDNEY).getTime()).toBe(
        Date.UTC(2026, 9, 4, 1, 0, 0)
      );
    });

    it('Mon 2026-10-05 09:00 local is AEDT (+11), i.e. Sun 22:00 UTC', () => {
      // 09:00 - 11h crosses midnight backwards: Sun 2026-10-04 22:00 UTC.
      expect(zonedTimeToUtc(2026, 10, 5, 9 * 60, SYDNEY).getTime()).toBe(
        Date.UTC(2026, 9, 4, 22, 0, 0)
      );
    });
  });

  describe('Europe/London', () => {
    it('winter local time is GMT (UTC+0)', () => {
      expect(zonedTimeToUtc(2026, 1, 15, 12 * 60, LONDON).getTime()).toBe(
        Date.UTC(2026, 0, 15, 12, 0, 0)
      );
    });

    it('summer local time is BST (UTC+1)', () => {
      // 12:00 - 1h = 11:00 UTC.
      expect(zonedTimeToUtc(2026, 7, 15, 12 * 60, LONDON).getTime()).toBe(
        Date.UTC(2026, 6, 15, 11, 0, 0)
      );
    });

    it('handles both sides of the March 2026 BST start (Sun Mar 29)', () => {
      // Sat Mar 28 12:00 GMT -> 12:00 UTC; Sun Mar 29 12:00 BST -> 11:00 UTC.
      expect(zonedTimeToUtc(2026, 3, 28, 12 * 60, LONDON).getTime()).toBe(
        Date.UTC(2026, 2, 28, 12, 0, 0)
      );
      expect(zonedTimeToUtc(2026, 3, 29, 12 * 60, LONDON).getTime()).toBe(
        Date.UTC(2026, 2, 29, 11, 0, 0)
      );
    });
  });

  it('round-trips through localParts', () => {
    const utc = zonedTimeToUtc(2026, 10, 5, 9 * 60 + 5, SYDNEY);
    const p = localParts(utc, SYDNEY);
    expect(p.dateKey).toBe('2026-10-05');
    expect(p.minuteOfDay).toBe(9 * 60 + 5);
  });
});

describe('isOpen — Sydney Mon-Fri 09:00-17:30', () => {
  const schedule = sydneySchedule();

  it('is open Tue 10:00 local', () => {
    // Tue 2026-08-18 10:00 AEST = 00:00 UTC (10:00 - 10h).
    expect(isOpen(new Date(Date.UTC(2026, 7, 18, 0, 0, 0)), schedule)).toBe(true);
  });

  it('is open at the 09:00 boundary (inclusive)', () => {
    // Tue 2026-08-18 09:00 AEST = Mon 2026-08-17 23:00 UTC.
    expect(isOpen(new Date(Date.UTC(2026, 7, 17, 23, 0, 0)), schedule)).toBe(true);
  });

  it('is open at 17:29 but closed at 17:30 (exclusive end) and 17:31', () => {
    // Tue 2026-08-18 17:29 AEST = 07:29 UTC.
    expect(isOpen(new Date(Date.UTC(2026, 7, 18, 7, 29, 0)), schedule)).toBe(true);
    expect(isOpen(new Date(Date.UTC(2026, 7, 18, 7, 30, 0)), schedule)).toBe(false);
    expect(isOpen(new Date(Date.UTC(2026, 7, 18, 7, 31, 0)), schedule)).toBe(false);
  });

  it('is closed on Saturday', () => {
    // Sat 2026-08-22 11:00 AEST = 01:00 UTC.
    expect(isOpen(new Date(Date.UTC(2026, 7, 22, 1, 0, 0)), schedule)).toBe(false);
  });

  it('is closed on a holiday even during normal hours', () => {
    // Wed 2026-08-19 10:00 AEST = 00:00 UTC. Open normally, closed when a holiday.
    const instant = new Date(Date.UTC(2026, 7, 19, 0, 0, 0));
    expect(isOpen(instant, schedule)).toBe(true);
    expect(isOpen(instant, sydneySchedule(['2026-08-19']))).toBe(false);
  });

  it('treats an empty-interval schedule as 24/7', () => {
    // Sunday 03:00 local — open anyway.
    expect(isOpen(new Date(Date.UTC(2026, 7, 22, 17, 0, 0)), alwaysOpen())).toBe(true);
  });
});

describe('nextOpenTime', () => {
  const schedule = sydneySchedule();

  it('rolls Friday 18:00 Sydney forward to Monday 09:00 Sydney (in UTC)', () => {
    // Fri 2026-08-21 18:00 AEST = 08:00 UTC.
    const from = new Date(Date.UTC(2026, 7, 21, 8, 0, 0));
    // Mon 2026-08-24 09:00 AEST = Sun 2026-08-23 23:00 UTC (09:00 - 10h crosses midnight).
    expect(nextOpenTime(from, schedule).getTime()).toBe(Date.UTC(2026, 7, 23, 23, 0, 0));
  });

  it('returns the input unchanged when already inside an open interval', () => {
    // Tue 2026-08-18 10:00 AEST = 00:00 UTC.
    const from = new Date(Date.UTC(2026, 7, 18, 0, 0, 0));
    expect(nextOpenTime(from, schedule).getTime()).toBe(from.getTime());
  });

  it('advances to the same-day opening when before hours', () => {
    // Tue 2026-08-18 07:00 AEST = Mon 2026-08-17 21:00 UTC -> opens Tue 09:00 AEST = Mon 23:00 UTC.
    const from = new Date(Date.UTC(2026, 7, 17, 21, 0, 0));
    expect(nextOpenTime(from, schedule).getTime()).toBe(Date.UTC(2026, 7, 17, 23, 0, 0));
  });

  it('skips a holiday Monday to Tuesday 09:00', () => {
    // Fri 2026-08-21 18:00 AEST, Mon 2026-08-24 is a holiday ->
    // Tue 2026-08-25 09:00 AEST = Mon 2026-08-24 23:00 UTC.
    const from = new Date(Date.UTC(2026, 7, 21, 8, 0, 0));
    expect(nextOpenTime(from, sydneySchedule(['2026-08-24'])).getTime()).toBe(
      Date.UTC(2026, 7, 24, 23, 0, 0)
    );
  });

  it('returns the input for a 24/7 schedule', () => {
    const from = new Date(Date.UTC(2026, 7, 22, 3, 12, 0));
    expect(nextOpenTime(from, alwaysOpen()).getTime()).toBe(from.getTime());
  });
});

describe('addBusinessMinutes', () => {
  const schedule = sydneySchedule();

  it('adds 15 minutes wholly inside open hours', () => {
    // Tue 2026-08-18 10:00 AEST (= 00:00 UTC) + 15 -> Tue 10:15 AEST = 00:15 UTC.
    const start = new Date(Date.UTC(2026, 7, 18, 0, 0, 0));
    expect(addBusinessMinutes(start, 15, schedule).getTime()).toBe(
      Date.UTC(2026, 7, 18, 0, 15, 0)
    );
  });

  it('spills Friday 17:20 + 15 min over the weekend to Monday 09:05', () => {
    // Fri 2026-08-21 17:20 AEST = 07:20 UTC. 10 minutes remain until the 17:30 close,
    // the other 5 land at Monday open: Mon 2026-08-24 09:05 AEST = Sun 2026-08-23 23:05 UTC.
    const start = new Date(Date.UTC(2026, 7, 21, 7, 20, 0));
    expect(addBusinessMinutes(start, 15, schedule).getTime()).toBe(
      Date.UTC(2026, 7, 23, 23, 5, 0)
    );
  });

  it('skips a full holiday when crossing it', () => {
    // Tue 2026-08-18 17:00 AEST (= 07:00 UTC) + 60, with Wed 2026-08-19 a holiday:
    // 30 minutes fit before Tuesday's 17:30 close, Wednesday is skipped entirely,
    // remaining 30 land Thu 2026-08-20 09:30 AEST = Wed 2026-08-19 23:30 UTC.
    const start = new Date(Date.UTC(2026, 7, 18, 7, 0, 0));
    expect(addBusinessMinutes(start, 60, sydneySchedule(['2026-08-19'])).getTime()).toBe(
      Date.UTC(2026, 7, 19, 23, 30, 0)
    );
  });

  it('degrades to plain minute addition for a 24/7 schedule', () => {
    // Saturday night, still counts: start + 90 plain minutes.
    const start = new Date(Date.UTC(2026, 7, 22, 13, 0, 0));
    expect(addBusinessMinutes(start, 90, alwaysOpen()).getTime()).toBe(
      start.getTime() + 90 * 60000
    );
  });

  describe('across the Sydney October 2026 DST start (Sun Oct 4, 02:00 AEST -> 03:00 AEDT)', () => {
    it('lands on the Monday wall clock at the NEW +11 offset (the promise follows the wall clock)', () => {
      // Fri 2026-10-02 17:00 AEST (+10) = 07:00 UTC. Add 45 business minutes:
      // 30 fit before Friday's 17:30 close; the remaining 15 land Monday at 09:15 local.
      // Monday 2026-10-05 is AEDT (+11), so 09:15 local = Sun 2026-10-04 22:15 UTC.
      // Had the engine wrongly kept the +10 offset it would return 23:15 UTC instead.
      const start = new Date(Date.UTC(2026, 9, 2, 7, 0, 0));
      const due = addBusinessMinutes(start, 45, schedule);
      expect(due.getTime()).toBe(Date.UTC(2026, 9, 4, 22, 15, 0));

      // And the local wall clock of the promise is Monday 09:15 Sydney.
      const p = localParts(due, SYDNEY);
      expect(p.dateKey).toBe('2026-10-05');
      expect(p.weekday).toBe(1); // Monday
      expect(p.minuteOfDay).toBe(9 * 60 + 15);
    });
  });
});

describe('businessMinutesBetween', () => {
  const schedule = sydneySchedule();

  it('counts a full business day as 510 minutes', () => {
    // Tue 2026-08-18 09:00 AEST (= Mon 23:00 UTC) .. Tue 17:30 AEST (= Tue 07:30 UTC)
    // = 8.5h = 510 minutes.
    const start = new Date(Date.UTC(2026, 7, 17, 23, 0, 0));
    const end = new Date(Date.UTC(2026, 7, 18, 7, 30, 0));
    expect(businessMinutesBetween(start, end, schedule)).toBe(510);
  });

  it('counts only weekday minutes across a weekend span', () => {
    // Fri 2026-08-21 17:00 AEST (= 07:00 UTC) .. Mon 2026-08-24 09:30 AEST (= Sun 23:30 UTC):
    // Friday 17:00-17:30 = 30 min, weekend = 0, Monday 09:00-09:30 = 30 min -> 60.
    const start = new Date(Date.UTC(2026, 7, 21, 7, 0, 0));
    const end = new Date(Date.UTC(2026, 7, 23, 23, 30, 0));
    expect(businessMinutesBetween(start, end, schedule)).toBe(60);
  });

  it('counts zero over a pure weekend interval', () => {
    // Sat 2026-08-22 00:00 AEST (= Fri 14:00 UTC) .. Mon 00:00 AEST (= Sun 14:00 UTC).
    const start = new Date(Date.UTC(2026, 7, 21, 14, 0, 0));
    const end = new Date(Date.UTC(2026, 7, 23, 14, 0, 0));
    expect(businessMinutesBetween(start, end, schedule)).toBe(0);
  });

  it('returns 0 when end is before (or equal to) start', () => {
    const start = new Date(Date.UTC(2026, 7, 18, 7, 30, 0));
    const end = new Date(Date.UTC(2026, 7, 17, 23, 0, 0));
    expect(businessMinutesBetween(start, end, schedule)).toBe(0);
    expect(businessMinutesBetween(start, start, schedule)).toBe(0);
  });

  it('counts plain elapsed minutes for a 24/7 schedule', () => {
    const start = new Date(Date.UTC(2026, 7, 22, 1, 0, 0));
    const end = new Date(Date.UTC(2026, 7, 22, 2, 30, 0));
    expect(businessMinutesBetween(start, end, alwaysOpen())).toBe(90);
  });
});

describe('formatLocalClock', () => {
  it('labels a Sydney business-hours instant and flags day + business hours', () => {
    // Tue 2026-08-18 10:00 AEST = 00:00 UTC.
    const r = formatLocalClock(new Date(Date.UTC(2026, 7, 18, 0, 0, 0)), SYDNEY);
    expect(r.label).toContain('10:00');
    expect(r.label).toContain('AM');
    expect(r.label).toContain('Tue');
    expect(r.label).toContain('· Sydney');
    expect(r.isDaytime).toBe(true);
    expect(r.isBusinessHoursGuess).toBe(true);
  });

  it('flags late night as neither daytime nor business hours', () => {
    // Tue 2026-08-18 23:00 AEST = 13:00 UTC.
    const r = formatLocalClock(new Date(Date.UTC(2026, 7, 18, 13, 0, 0)), SYDNEY);
    expect(r.label).toContain('11:00');
    expect(r.label).toContain('PM');
    expect(r.isDaytime).toBe(false);
    expect(r.isBusinessHoursGuess).toBe(false);
  });

  it('flags a weekend morning as daytime but not business hours', () => {
    // Sat 2026-08-22 10:00 AEST = 00:00 UTC.
    const r = formatLocalClock(new Date(Date.UTC(2026, 7, 22, 0, 0, 0)), SYDNEY);
    expect(r.isDaytime).toBe(true);
    expect(r.isBusinessHoursGuess).toBe(false);
  });

  it('humanizes underscored city names', () => {
    // Mon 2026-08-17 20:00 EDT (UTC-4) = Tue 00:00 UTC. 20:00 is daytime (<21) but after hours.
    const r = formatLocalClock(new Date(Date.UTC(2026, 7, 18, 0, 0, 0)), 'America/New_York');
    expect(r.label).toContain('· New York');
    expect(r.isDaytime).toBe(true);
    expect(r.isBusinessHoursGuess).toBe(false);
  });
});
