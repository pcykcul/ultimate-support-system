/**
 * Schedules & Holidays (supervisor+): business-hours schedules with a weekly
 * grid editor (one interval per day; times convert to minutes-since-midnight),
 * holiday calendars with country packs, and a "preview local time" chip that
 * uses the server clock helper so client and server always agree.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, Moon, Plus, Star, Sun, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMe } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Modal, Select } from '@/lib/ui';
import {
  ErrorNote,
  Field,
  listTimezones,
  Loading,
  minutesToTime,
  timeToMinutes,
  type HolidayCalendar,
  type Schedule,
  type ScheduleInterval,
  useHolidayCalendars,
  useSchedules,
} from './shared';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const COUNTRY_PACKS = [
  { code: 'AU', label: 'Australia' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'CA', label: 'Canada' },
];

interface DayRow {
  enabled: boolean;
  start: string; // 'HH:MM'
  end: string;
}

const DEFAULT_DAY: DayRow = { enabled: false, start: '09:00', end: '17:00' };

function rowsFromIntervals(intervals: ScheduleInterval[]): DayRow[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    // Editor keeps one interval per day; split shifts stay intact until edited here.
    const iv = intervals.find((i) => i.weekday === weekday);
    return iv
      ? { enabled: true, start: minutesToTime(iv.startMinute), end: minutesToTime(iv.endMinute) }
      : { ...DEFAULT_DAY };
  });
}

function intervalsFromRows(rows: DayRow[]): ScheduleInterval[] {
  return rows.flatMap((r, weekday) =>
    r.enabled && timeToMinutes(r.end) > timeToMinutes(r.start)
      ? [{ weekday, startMinute: timeToMinutes(r.start), endMinute: timeToMinutes(r.end) }]
      : []
  );
}

export default function SchedulesSection() {
  const { data: me } = useMe();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading } = useSchedules();
  const schedules = data?.items ?? [];
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">Schedules</h2>
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} /> New schedule
          </Button>
        </div>
        {isLoading ? (
          <Loading />
        ) : schedules.length === 0 ? (
          <Card>
            <EmptyState title="No schedules" hint="Business hours drive SLA clocks and honest chat presence." />
          </Card>
        ) : (
          <div className="space-y-4">
            {schedules.map((s) => (
              <ScheduleCard key={s.id} schedule={s} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </section>

      <HolidayCalendarsBlock isAdmin={isAdmin} />

      {creating && <CreateScheduleModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function ScheduleCard({ schedule, isAdmin }: { schedule: Schedule; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: calsData } = useHolidayCalendars();
  const calendars = calsData?.items ?? [];

  const [name, setName] = useState(schedule.name);
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [calendarId, setCalendarId] = useState(schedule.holidayCalendarId ?? '');
  const [rows, setRows] = useState<DayRow[]>(() => rowsFromIntervals(schedule.intervals));
  const [preview, setPreview] = useState<{ label: string; isDaytime: boolean } | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'schedules'] });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/schedules/${schedule.id}`, {
        name: name.trim(),
        timezone,
        holidayCalendarId: calendarId || null,
        intervals: intervalsFromRows(rows),
      }),
    onSuccess: invalidate,
  });
  const makeDefault = useMutation({
    mutationFn: () => api.patch(`/api/schedules/${schedule.id}`, { isDefault: true }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/schedules/${schedule.id}`),
    onSuccess: invalidate,
  });
  const previewTime = useMutation({
    mutationFn: () =>
      api.get<{ label: string; isDaytime: boolean }>(
        `/api/schedules/preview-local-time?timezone=${encodeURIComponent(timezone)}`
      ),
    onSuccess: setPreview,
  });

  const setRow = (i: number, patch: Partial<DayRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button
          title={schedule.isDefault ? 'Default schedule' : 'Make default'}
          className="p-1"
          onClick={() => !schedule.isDefault && makeDefault.mutate()}
        >
          <Star
            size={17}
            className={schedule.isDefault ? 'text-yellow-500 fill-yellow-400' : 'text-gray-300 hover:text-yellow-500'}
          />
        </button>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {listTimezones().map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => previewTime.mutate()} disabled={previewTime.isPending}>
          <Clock size={14} /> Preview local time
        </Button>
        {preview && (
          <Badge color={preview.isDaytime ? 'yellow' : 'blue'}>
            {preview.isDaytime ? <Sun size={12} className="mr-1" /> : <Moon size={12} className="mr-1" />}
            {preview.label}
          </Badge>
        )}
        <div className="flex-1" />
        {isAdmin && (
          <Button
            variant="ghost"
            title="Delete schedule"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete schedule "${schedule.name}"?`)) remove.mutate();
            }}
          >
            <Trash2 size={15} />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[6rem_auto_auto] sm:grid-cols-[8rem_auto_auto_1fr] items-center gap-x-2 sm:gap-x-3 gap-y-1.5">
        {rows.map((row, weekday) => (
          <WeekdayRow key={weekday} label={WEEKDAYS[weekday]} row={row} onChange={(p) => setRow(weekday, p)} />
        ))}
      </div>

      <div className="flex items-end gap-3">
        <Field label="Holiday calendar" className="w-64">
          <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className="w-full">
            <option value="">None</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
          {save.isPending ? 'Saving…' : 'Save schedule'}
        </Button>
        {save.isSuccess && !save.isPending && <span className="text-sm text-green-600 pb-1.5">Saved.</span>}
      </div>
      <ErrorNote error={save.error ?? makeDefault.error ?? remove.error ?? previewTime.error} />
    </Card>
  );
}

function WeekdayRow({
  label,
  row,
  onChange,
}: {
  label: string;
  row: DayRow;
  onChange: (patch: Partial<DayRow>) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={row.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        {label}
      </label>
      <input
        type="time"
        value={row.start}
        disabled={!row.enabled}
        onChange={(e) => onChange({ start: e.target.value })}
        className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-40"
      />
      <input
        type="time"
        value={row.end}
        disabled={!row.enabled}
        onChange={(e) => onChange({ end: e.target.value })}
        className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-40"
      />
      <span className="text-xs text-gray-400">{row.enabled ? '' : 'Closed'}</span>
    </>
  );
}

function CreateScheduleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/schedules', {
        name: name.trim(),
        timezone,
        // Sensible starting point: Mon–Fri 9:00–17:00.
        intervals: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'schedules'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="New schedule">
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sydney business hours" autoFocus />
        </Field>
        <Field label="Timezone">
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full">
            {listTimezones().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-gray-400">Starts as Mon–Fri 9:00–17:00 — adjust the grid after creating.</p>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Holiday calendars ----------

function HolidayCalendarsBlock({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useHolidayCalendars();
  const calendars = data?.items ?? [];
  const [newName, setNewName] = useState('');
  const [importing, setImporting] = useState(false);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'holiday-calendars'] });

  const create = useMutation({
    mutationFn: () => api.post('/api/schedules/holiday-calendars', { name: newName.trim() }),
    onSuccess: () => {
      setNewName('');
      invalidate();
    },
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-800">Holiday calendars</h2>
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New calendar name"
            className="w-44"
          />
          <Button variant="secondary" onClick={() => create.mutate()} disabled={create.isPending || !newName.trim()}>
            <Plus size={15} /> Add
          </Button>
          <Button onClick={() => setImporting(true)}>
            <Download size={15} /> Import country pack
          </Button>
        </div>
      </div>
      <ErrorNote error={create.error} />
      {isLoading ? (
        <Loading />
      ) : calendars.length === 0 ? (
        <Card>
          <EmptyState
            title="No holiday calendars"
            hint="Import a country pack (AU, US, GB, NZ, CA) or add one manually — SLA clocks pause on holidays."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {calendars.map((c) => (
            <CalendarCard key={c.id} calendar={c} isAdmin={isAdmin} onChanged={invalidate} />
          ))}
        </div>
      )}
      {importing && <ImportPackModal onClose={() => setImporting(false)} onDone={invalidate} />}
    </section>
  );
}

function CalendarCard({
  calendar,
  isAdmin,
  onChanged,
}: {
  calendar: HolidayCalendar;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');

  const addHoliday = useMutation({
    mutationFn: () =>
      api.post(`/api/schedules/holiday-calendars/${calendar.id}/holidays`, { name: name.trim(), date }),
    onSuccess: () => {
      setName('');
      setDate('');
      onChanged();
    },
  });
  const removeHoliday = useMutation({
    mutationFn: (holidayId: string) => api.delete(`/api/schedules/holidays/${holidayId}`),
    onSuccess: onChanged,
  });
  const removeCalendar = useMutation({
    mutationFn: () => api.delete(`/api/schedules/holiday-calendars/${calendar.id}`),
    onSuccess: onChanged,
  });

  const sorted = [...calendar.holidays].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold flex-1 truncate">{calendar.name}</p>
        {calendar.countryCode && <Badge color="blue">{calendar.countryCode}</Badge>}
        {isAdmin && (
          <Button
            variant="ghost"
            title="Delete calendar"
            disabled={removeCalendar.isPending}
            onClick={() => {
              if (window.confirm(`Delete calendar "${calendar.name}"?`)) removeCalendar.mutate();
            }}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400">No holidays yet.</p>
      ) : (
        <ul className="max-h-44 overflow-y-auto divide-y divide-gray-50 text-sm">
          {sorted.map((h) => (
            <li key={h.id} className="flex items-center gap-2 py-1">
              <span className="text-xs text-gray-500 font-mono w-24 shrink-0">{h.date}</span>
              <span className="flex-1 truncate">{h.name}</span>
              <button
                className="text-gray-300 hover:text-red-500 text-xs"
                title="Remove holiday"
                onClick={() => removeHoliday.mutate(h.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 pt-1">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
        />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Holiday name" className="flex-1" />
        <Button
          variant="secondary"
          onClick={() => addHoliday.mutate()}
          disabled={addHoliday.isPending || !name.trim() || !date}
        >
          Add
        </Button>
      </div>
      <ErrorNote error={addHoliday.error ?? removeHoliday.error ?? removeCalendar.error} />
    </Card>
  );
}

function ImportPackModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [countryCode, setCountryCode] = useState('AU');
  const [year, setYear] = useState(new Date().getFullYear());

  const importPack = useMutation({
    mutationFn: () => api.post('/api/schedules/holiday-calendars/import', { countryCode, year }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Import country pack">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Creates a calendar pre-filled with the country's public holidays for the chosen year.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country">
            <Select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="w-full">
              {COUNTRY_PACKS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year">
            <Input
              type="number"
              min={2026}
              max={2027}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
        </div>
        <ErrorNote error={importPack.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => importPack.mutate()} disabled={importPack.isPending}>
            <Download size={15} /> {importPack.isPending ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
