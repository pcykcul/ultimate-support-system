/**
 * Built-in national public holiday packs for the holiday-calendar import endpoint.
 * Plain data, hardcoded per country per year — no external calendar service, no cleverness.
 *
 * Dates marked "(observed)" / "(substitute)" are the weekday the holiday is actually taken
 * when the calendar date lands on a weekend (US: nearest weekday; GB/CA: following Monday
 * or Tuesday; AU/NZ: substitute Monday/Tuesday, with NZ Mondayisation for Waitangi/Anzac).
 * Days that are genuinely observed on the weekend date (e.g. Anzac Day in most AU states)
 * keep their real date.
 */

export interface PackHoliday {
  name: string;
  date: string; // 'YYYY-MM-DD' local date
}

export interface HolidayPack {
  countryCode: string;
  countryName: string;
  years: Record<number, PackHoliday[]>;
}

export const HOLIDAY_PACKS: Record<string, HolidayPack> = {
  AU: {
    countryCode: 'AU',
    countryName: 'Australia',
    years: {
      2026: [
        { name: "New Year's Day", date: '2026-01-01' },
        { name: 'Australia Day', date: '2026-01-26' },
        { name: 'Good Friday', date: '2026-04-03' },
        { name: 'Easter Monday', date: '2026-04-06' },
        { name: 'Anzac Day', date: '2026-04-25' },
        { name: "King's Birthday", date: '2026-06-08' },
        { name: 'Christmas Day', date: '2026-12-25' },
        { name: 'Boxing Day (observed)', date: '2026-12-28' },
      ],
      2027: [
        { name: "New Year's Day", date: '2027-01-01' },
        { name: 'Australia Day', date: '2027-01-26' },
        { name: 'Good Friday', date: '2027-03-26' },
        { name: 'Easter Monday', date: '2027-03-29' },
        { name: 'Anzac Day', date: '2027-04-25' },
        { name: "King's Birthday", date: '2027-06-14' },
        { name: 'Christmas Day (observed)', date: '2027-12-27' },
        { name: 'Boxing Day (observed)', date: '2027-12-28' },
      ],
    },
  },
  US: {
    countryCode: 'US',
    countryName: 'United States',
    years: {
      2026: [
        { name: "New Year's Day", date: '2026-01-01' },
        { name: 'Martin Luther King Jr. Day', date: '2026-01-19' },
        { name: "Washington's Birthday (Presidents' Day)", date: '2026-02-16' },
        { name: 'Memorial Day', date: '2026-05-25' },
        { name: 'Juneteenth National Independence Day', date: '2026-06-19' },
        { name: 'Independence Day (observed)', date: '2026-07-03' },
        { name: 'Labor Day', date: '2026-09-07' },
        { name: 'Columbus Day', date: '2026-10-12' },
        { name: 'Veterans Day', date: '2026-11-11' },
        { name: 'Thanksgiving Day', date: '2026-11-26' },
        { name: 'Christmas Day', date: '2026-12-25' },
      ],
      2027: [
        { name: "New Year's Day", date: '2027-01-01' },
        { name: 'Martin Luther King Jr. Day', date: '2027-01-18' },
        { name: "Washington's Birthday (Presidents' Day)", date: '2027-02-15' },
        { name: 'Memorial Day', date: '2027-05-31' },
        { name: 'Juneteenth National Independence Day (observed)', date: '2027-06-18' },
        { name: 'Independence Day (observed)', date: '2027-07-05' },
        { name: 'Labor Day', date: '2027-09-06' },
        { name: 'Columbus Day', date: '2027-10-11' },
        { name: 'Veterans Day', date: '2027-11-11' },
        { name: 'Thanksgiving Day', date: '2027-11-25' },
        { name: 'Christmas Day (observed)', date: '2027-12-24' },
      ],
    },
  },
  GB: {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    years: {
      2026: [
        { name: "New Year's Day", date: '2026-01-01' },
        { name: 'Good Friday', date: '2026-04-03' },
        { name: 'Easter Monday', date: '2026-04-06' },
        { name: 'Early May Bank Holiday', date: '2026-05-04' },
        { name: 'Spring Bank Holiday', date: '2026-05-25' },
        { name: 'Summer Bank Holiday', date: '2026-08-31' },
        { name: 'Christmas Day', date: '2026-12-25' },
        { name: 'Boxing Day (substitute)', date: '2026-12-28' },
      ],
      2027: [
        { name: "New Year's Day", date: '2027-01-01' },
        { name: 'Good Friday', date: '2027-03-26' },
        { name: 'Easter Monday', date: '2027-03-29' },
        { name: 'Early May Bank Holiday', date: '2027-05-03' },
        { name: 'Spring Bank Holiday', date: '2027-05-31' },
        { name: 'Summer Bank Holiday', date: '2027-08-30' },
        { name: 'Christmas Day (substitute)', date: '2027-12-27' },
        { name: 'Boxing Day (substitute)', date: '2027-12-28' },
      ],
    },
  },
  NZ: {
    countryCode: 'NZ',
    countryName: 'New Zealand',
    years: {
      2026: [
        { name: "New Year's Day", date: '2026-01-01' },
        { name: "Day after New Year's Day", date: '2026-01-02' },
        { name: 'Waitangi Day', date: '2026-02-06' },
        { name: 'Good Friday', date: '2026-04-03' },
        { name: 'Easter Monday', date: '2026-04-06' },
        { name: 'Anzac Day (observed)', date: '2026-04-27' },
        { name: "King's Birthday", date: '2026-06-01' },
        { name: 'Matariki', date: '2026-07-10' },
        { name: 'Labour Day', date: '2026-10-26' },
        { name: 'Christmas Day', date: '2026-12-25' },
        { name: 'Boxing Day (observed)', date: '2026-12-28' },
      ],
      2027: [
        { name: "New Year's Day", date: '2027-01-01' },
        { name: "Day after New Year's Day (observed)", date: '2027-01-04' },
        { name: 'Waitangi Day (observed)', date: '2027-02-08' },
        { name: 'Good Friday', date: '2027-03-26' },
        { name: 'Easter Monday', date: '2027-03-29' },
        { name: 'Anzac Day (observed)', date: '2027-04-26' },
        { name: "King's Birthday", date: '2027-06-07' },
        { name: 'Matariki', date: '2027-06-25' },
        { name: 'Labour Day', date: '2027-10-25' },
        { name: 'Christmas Day (observed)', date: '2027-12-27' },
        { name: 'Boxing Day (observed)', date: '2027-12-28' },
      ],
    },
  },
  CA: {
    countryCode: 'CA',
    countryName: 'Canada',
    years: {
      2026: [
        { name: "New Year's Day", date: '2026-01-01' },
        { name: 'Good Friday', date: '2026-04-03' },
        { name: 'Victoria Day', date: '2026-05-18' },
        { name: 'Canada Day', date: '2026-07-01' },
        { name: 'Labour Day', date: '2026-09-07' },
        { name: 'National Day for Truth and Reconciliation', date: '2026-09-30' },
        { name: 'Thanksgiving', date: '2026-10-12' },
        { name: 'Remembrance Day', date: '2026-11-11' },
        { name: 'Christmas Day', date: '2026-12-25' },
        { name: 'Boxing Day (observed)', date: '2026-12-28' },
      ],
      2027: [
        { name: "New Year's Day", date: '2027-01-01' },
        { name: 'Good Friday', date: '2027-03-26' },
        { name: 'Victoria Day', date: '2027-05-24' },
        { name: 'Canada Day', date: '2027-07-01' },
        { name: 'Labour Day', date: '2027-09-06' },
        { name: 'National Day for Truth and Reconciliation', date: '2027-09-30' },
        { name: 'Thanksgiving', date: '2027-10-11' },
        { name: 'Remembrance Day', date: '2027-11-11' },
        { name: 'Christmas Day (observed)', date: '2027-12-27' },
        { name: 'Boxing Day (observed)', date: '2027-12-28' },
      ],
    },
  },
};

/** Look up a pack; returns null when the country/year combination isn't built in. */
export function getHolidayPack(
  countryCode: string,
  year: number
): { name: string; countryCode: string; holidays: PackHoliday[] } | null {
  const pack = HOLIDAY_PACKS[countryCode.toUpperCase()];
  const holidays = pack?.years[year];
  if (!pack || !holidays) return null;
  return { name: `${pack.countryName} ${year}`, countryCode: pack.countryCode, holidays };
}

export const AVAILABLE_PACKS = Object.values(HOLIDAY_PACKS).map((p) => ({
  countryCode: p.countryCode,
  countryName: p.countryName,
  years: Object.keys(p.years).map(Number),
}));
