/**
 * Branding (admin): white-label identity + brand colors with a live preview.
 * Colors are stored as 'R G B' strings so they slot straight into the CSS
 * custom properties (see applyBrandColors).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Save } from 'lucide-react';
import { api } from '@/api/client';
import { applyBrandColors } from '@/lib/session';
import { Button, Card, Input, Textarea } from '@/lib/ui';
import { ErrorNote, Field, getOr, Loading } from './shared';

interface BrandingSettings {
  name: string;
  logoUrl: string | null;
  colors: { brand?: string; brandSoft?: string; brandFg?: string } | null;
  helpCenterTitle: string | null;
  humanPromise: string | null;
  emailFrom: string | null;
}

const EMPTY: BrandingSettings = {
  name: '',
  logoUrl: null,
  colors: null,
  helpCenterTitle: null,
  humanPromise: null,
  emailFrom: null,
};

const RGB_RE = /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/;

function Swatch({ rgb }: { rgb: string }) {
  const ok = RGB_RE.test(rgb.trim());
  return (
    <span
      className="inline-block h-8 w-8 shrink-0 rounded-lg border border-gray-300"
      style={{ backgroundColor: ok ? `rgb(${rgb.trim()})` : 'transparent' }}
      title={ok ? `rgb(${rgb.trim()})` : 'Enter as "R G B", e.g. 37 99 235'}
    />
  );
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
}

export default function BrandingSection() {
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
        brand: data.colors?.brand ?? '',
        brandSoft: data.colors?.brandSoft ?? '',
        brandFg: data.colors?.brandFg ?? '',
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
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'branding-admin'] });
      void qc.invalidateQueries({ queryKey: ['branding'] }); // public branding used by Layout
    },
  });

  if (isLoading || form === null) return <Loading />;

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  const colorRows: { key: 'brand' | 'brandSoft' | 'brandFg'; label: string; hint: string }[] = [
    { key: 'brand', label: 'Brand color', hint: 'Buttons, links, active nav' },
    { key: 'brandSoft', label: 'Brand soft', hint: 'Tinted backgrounds and badges' },
    { key: 'brandFg', label: 'Brand foreground', hint: 'Text on top of the brand color' },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-brand-soft/50 border-brand/20">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">White-label:</span> these settings rebrand every surface — no fork
          needed.
        </p>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
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
        {colorRows.map(({ key, label, hint }) => (
          <div key={key} className="flex items-end gap-3">
            <Field label={label} hint={hint} className="flex-1">
              <Input
                value={form[key]}
                onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)}
                placeholder="37 99 235"
              />
            </Field>
            <div className="pb-5">
              <Swatch rgb={form[key]} />
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-400">Space-separated RGB, e.g. "37 99 235".</p>
        <Button variant="secondary" onClick={() => applyBrandColors(colorsOf(form))}>
          <Eye size={15} /> Preview colors now
        </Button>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name.trim()}>
          <Save size={15} /> {save.isPending ? 'Saving…' : 'Save branding'}
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
