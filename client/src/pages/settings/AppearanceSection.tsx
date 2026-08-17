/**
 * Appearance (admin): white-label identity, brand colors and font with live
 * preview. Colors are stored as 'R G B' strings so they slot straight into the
 * CSS custom properties (see applyBrandColors); the native color picker is a
 * convenience on top with a text fallback for exact values.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save } from 'lucide-react';
import { api } from '@/api/client';
import { applyBrandColors, FONT_STACKS } from '@/lib/session';
import { Button, Card, cx, Input, Textarea } from '@/lib/ui';
import { ErrorNote, Field, getOr, Loading } from './shared';

interface BrandingSettings {
  name: string;
  logoUrl: string | null;
  colors: { brand?: string; brandSoft?: string; brandFg?: string } | null;
  font: string | null;
  helpCenterTitle: string | null;
  humanPromise: string | null;
  emailFrom: string | null;
}

const EMPTY: BrandingSettings = {
  name: '',
  logoUrl: null,
  colors: null,
  font: null,
  helpCenterTitle: null,
  humanPromise: null,
  emailFrom: null,
};

/** Mirror of the server-side defaults, used by "Reset to defaults". */
const DEFAULT_COLORS = { brand: '37 99 235', brandSoft: '219 234 254', brandFg: '255 255 255' };

const RGB_RE = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;

function rgbToHex(rgb: string): string | null {
  const m = RGB_RE.exec(rgb.trim());
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

interface FormState {
  name: string;
  logoUrl: string;
  helpCenterTitle: string;
  humanPromise: string;
  emailFrom: string;
  brand: string;
  brandSoft: string;
  brandFg: string;
  font: string;
}

const COLOR_ROWS: { key: 'brand' | 'brandSoft' | 'brandFg'; label: string; hint: string }[] = [
  { key: 'brand', label: 'Brand color', hint: 'Buttons, links, active nav' },
  { key: 'brandSoft', label: 'Brand soft', hint: 'Tinted backgrounds and badges' },
  { key: 'brandFg', label: 'Brand foreground', hint: 'Text on top of the brand color' },
];

export default function AppearanceSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'branding-admin'],
    queryFn: () => getOr<BrandingSettings>('/api/settings/branding', EMPTY),
  });

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (data && form === null) {
      setForm({
        name: data.name ?? '',
        logoUrl: data.logoUrl ?? '',
        helpCenterTitle: data.helpCenterTitle ?? '',
        humanPromise: data.humanPromise ?? '',
        emailFrom: data.emailFrom ?? '',
        brand: data.colors?.brand ?? DEFAULT_COLORS.brand,
        brandSoft: data.colors?.brandSoft ?? DEFAULT_COLORS.brandSoft,
        brandFg: data.colors?.brandFg ?? DEFAULT_COLORS.brandFg,
        font: data.font ?? 'system',
      });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: (f: FormState) =>
      api.put('/api/settings/branding', {
        name: f.name.trim(),
        logoUrl: f.logoUrl.trim() || undefined,
        helpCenterTitle: f.helpCenterTitle.trim() || undefined,
        humanPromise: f.humanPromise.trim() || undefined,
        emailFrom: f.emailFrom.trim() || undefined,
        colors: colorsOf(f),
        font: f.font || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'branding-admin'] });
      void qc.invalidateQueries({ queryKey: ['branding'] }); // public branding used by Layout
    },
  });

  if (isLoading || form === null) return <Loading />;

  /** Every appearance change previews live — save makes it stick for everyone. */
  const set = (patch: Partial<FormState>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if ('brand' in patch || 'brandSoft' in patch || 'brandFg' in patch || 'font' in patch) {
      applyBrandColors(colorsOf(next), next.font || null);
    }
  };

  const resetDefaults = () => {
    set({ ...DEFAULT_COLORS, font: 'system' });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-brand-soft/50 border-brand/20">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">White-label:</span> these settings rebrand every surface — no fork
          needed.
        </p>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Identity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" hint="Shown in the sidebar, emails and browser title">
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Acme Support" />
          </Field>
          <Field label="Logo URL">
            <Input
              value={form.logoUrl}
              onChange={(e) => set({ logoUrl: e.target.value })}
              placeholder="https://…/logo.png"
            />
          </Field>
          <Field label="Help center title">
            <Input
              value={form.helpCenterTitle}
              onChange={(e) => set({ helpCenterTitle: e.target.value })}
              placeholder="How can we help?"
            />
          </Field>
          <Field label="Email from" hint="Sender address on outbound mail">
            <Input
              value={form.emailFrom}
              onChange={(e) => set({ emailFrom: e.target.value })}
              placeholder="support@acme.com"
            />
          </Field>
        </div>
        <Field
          label="Human promise"
          hint="The response-time promise customers see — a person, never a bot"
        >
          <Textarea
            rows={2}
            value={form.humanPromise}
            onChange={(e) => set({ humanPromise: e.target.value })}
            placeholder="A real person will reply within 4 business hours."
          />
        </Field>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">Colors</h2>
        {COLOR_ROWS.map(({ key, label, hint }) => {
          const hex = rgbToHex(form[key]);
          return (
            <div key={key} className="flex flex-wrap items-end gap-3">
              <Field label={label} hint={hint} className="flex-1 min-w-[12rem]">
                <Input
                  value={form[key]}
                  onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)}
                  placeholder="37 99 235"
                />
              </Field>
              <div className="pb-5">
                <input
                  type="color"
                  aria-label={`${label} picker`}
                  value={hex ?? '#000000'}
                  onChange={(e) => set({ [key]: hexToRgb(e.target.value) } as Partial<FormState>)}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5"
                />
              </div>
            </div>
          );
        })}
        <p className="text-xs text-gray-400">
          Pick a color or type space-separated RGB, e.g. "37 99 235". Changes preview instantly.
        </p>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">Font</h2>
        <p className="text-xs text-gray-500">
          Curated system font stacks — nothing downloads from the internet, so self-hosted stays
          self-contained.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(FONT_STACKS).map(([key, { label, css }]) => {
            const selected = form.font === key;
            return (
              <label
                key={key}
                className={cx(
                  'block cursor-pointer rounded-lg border p-3 transition-colors',
                  selected ? 'border-brand ring-1 ring-brand bg-brand-soft/40' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <input
                  type="radio"
                  name="brand-font"
                  className="sr-only"
                  checked={selected}
                  onChange={() => set({ font: key })}
                />
                <span className="block text-sm font-semibold text-gray-800" style={{ fontFamily: css }}>
                  {label}
                </span>
                <span className="mt-1 block text-xs text-gray-500" style={{ fontFamily: css }}>
                  A real person will reply — AaBbCc 0123
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name.trim()}>
          <Save size={15} /> {save.isPending ? 'Saving…' : 'Save appearance'}
        </Button>
        <Button variant="secondary" onClick={resetDefaults}>
          <RotateCcw size={15} /> Reset colors & font to defaults
        </Button>
        {save.isSuccess && !save.isPending && <span className="text-sm text-green-600">Saved.</span>}
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}

function colorsOf(f: FormState): { brand?: string; brandSoft?: string; brandFg?: string } {
  return {
    ...(f.brand.trim() ? { brand: f.brand.trim() } : {}),
    ...(f.brandSoft.trim() ? { brandSoft: f.brandSoft.trim() } : {}),
    ...(f.brandFg.trim() ? { brandFg: f.brandFg.trim() } : {}),
  };
}
