/**
 * Email templates (admin): customize the subjects/bodies of every automated
 * email the system sends. Variables render as clickable chips that insert at
 * the cursor; a live preview substitutes representative sample data client-side
 * so admins see roughly what the customer/staff member will receive.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, Send } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, cx } from '@/lib/ui';
import { ErrorNote, Field, Loading } from './shared';

// Raw input/textarea (styled like @/lib/ui's) — the shared components don't
// forward refs, and insert-at-cursor needs direct element access.
const INPUT_CLASSES =
  'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';
const TEXTAREA_CLASSES =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand';

interface TemplateData {
  subject: string;
  body: string;
  isDefault: boolean;
}

interface TemplateVariable {
  name: string;
  description: string;
}

interface TemplatesResponse {
  templates: Record<string, TemplateData>;
  variables: Record<string, TemplateVariable[]>;
}

const FRIENDLY_NAMES: Record<string, string> = {
  ticket_receipt: 'Ticket receipt',
  agent_reply: 'Agent reply',
  staff_invite: 'Staff invite',
  sla_alert: 'SLA alert',
  csat_request: 'CSAT request',
};

const DESCRIPTIONS: Record<string, string> = {
  ticket_receipt: 'The automated receipt customers get when a ticket is created.',
  agent_reply: "Wraps an agent's public reply when it goes out by email.",
  staff_invite: 'Sent when a new staff member is invited.',
  sla_alert: 'Staff alert when an SLA target is at risk or breached.',
  csat_request: 'Asks the customer how it went after their ticket is solved.',
};

/** Sample data for the client-side preview — mirrors the server's test-send samples. */
const SAMPLE_VARS: Record<string, string> = {
  'customer.name': 'Alex Sample',
  'ticket.number': '1042',
  'ticket.subject': 'Cannot sign in to my account',
  'ticket.url': 'https://example.com/tickets/sample',
  promise: ' by tomorrow 9:00 AM (your local time)',
  'reply.body':
    "Thanks for the details — I've reset your session and you should be able to sign in now. Let me know if anything still looks off.",
  'agent.name': 'Sam Agent',
  'agent.titleLine': '\nSupport Engineer',
  'invite.name': 'Jordan New',
  'invite.role': 'agent',
  'invite.url': 'https://example.com/accept-invite?token=sample',
  'alert.kind': 'warning',
  'alert.detail': 'The first_response SLA target is due in about 30 minutes.',
  'csat.url': 'https://example.com/portal/tickets/sample',
  'brand.name': 'Acme Support',
};

function renderSample(template: string): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => SAMPLE_VARS[key] ?? '');
}

export default function EmailTemplatesSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'email-templates'],
    queryFn: () => api.get<TemplatesResponse>('/api/settings/email-templates'),
  });

  const keys = data ? Object.keys(data.templates) : [];
  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = selected ?? keys[0] ?? null;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocus = useRef<'subject' | 'body'>('body');

  // Load the editor whenever the selected template (or fresh server data) changes.
  useEffect(() => {
    if (!data || !activeKey) return;
    if (loadedKey === activeKey) return;
    const t = data.templates[activeKey];
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
    setLoadedKey(activeKey);
  }, [data, activeKey, loadedKey]);

  const save = useMutation({
    mutationFn: (input: { key: string; subject: string; body: string }) =>
      api.put<TemplateData>(`/api/settings/email-templates/${input.key}`, {
        subject: input.subject,
        body: input.body,
      }),
    onSuccess: (result) => {
      setSubject(result.subject);
      setBody(result.body);
      void qc.invalidateQueries({ queryKey: ['settings', 'email-templates'] });
    },
  });

  const sendTest = useMutation({
    mutationFn: (key: string) => api.post<{ ok: boolean; to: string }>(`/api/settings/email-templates/${key}/test`),
  });

  if (isLoading || !data || !activeKey) return <Loading />;

  const current = data.templates[activeKey];
  const variables = data.variables[activeKey] ?? [];
  const dirty = current ? subject !== current.subject || body !== current.body : false;

  const pick = (key: string) => {
    setSelected(key);
    setLoadedKey(null); // force the editor to load the newly selected template
    sendTest.reset();
    save.reset();
  };

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    if (lastFocus.current === 'subject') {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? body.length;
      const end = el?.selectionEnd ?? body.length;
      setBody(body.slice(0, start) + token + body.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-brand-soft/50 border-brand/20">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Human Guarantee:</span> automated emails must stay visibly
          automated — keep receipts labeled as receipts, never fake a human reply.
        </p>
      </Card>

      <div className="flex flex-col lg:flex-row items-start gap-4">
        {/* Template list — chips on mobile, a column on desktop */}
        <div className="w-full lg:w-52 shrink-0 flex flex-wrap lg:flex-col gap-1.5">
          {keys.map((key) => {
            const t = data.templates[key]!;
            const active = key === activeKey;
            return (
              <button
                key={key}
                onClick={() => pick(key)}
                className={cx(
                  'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium text-left',
                  'w-auto lg:w-full',
                  active ? 'bg-brand-soft text-brand' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <span>{FRIENDLY_NAMES[key] ?? key}</span>
                {t.isDefault && (
                  <Badge color="gray" className="hidden lg:inline-flex">
                    default
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0 w-full space-y-4">
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-800">{FRIENDLY_NAMES[activeKey] ?? activeKey}</h2>
              {current?.isDefault ? <Badge color="gray">default</Badge> : <Badge color="brand">customized</Badge>}
            </div>
            <p className="text-xs text-gray-500 -mt-2">{DESCRIPTIONS[activeKey]}</p>

            <Field label="Subject">
              <input
                ref={subjectRef}
                className={INPUT_CLASSES}
                value={subject}
                onFocus={() => (lastFocus.current = 'subject')}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
            <Field label="Body">
              <textarea
                ref={bodyRef}
                rows={10}
                className={cx(TEXTAREA_CLASSES, 'font-mono text-xs')}
                value={body}
                onFocus={() => (lastFocus.current = 'body')}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>

            <Field label="Variables" hint="Click to insert at the cursor">
              <div className="flex flex-wrap gap-1.5">
                {variables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    title={v.description}
                    onClick={() => insertVariable(v.name)}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-mono text-gray-700 hover:bg-brand-soft hover:text-brand"
                  >
                    {'{{' + v.name + '}}'}
                  </button>
                ))}
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => save.mutate({ key: activeKey, subject, body })}
                disabled={save.isPending || !dirty}
              >
                <Save size={15} /> {save.isPending ? 'Saving…' : 'Save template'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => sendTest.mutate(activeKey)}
                disabled={sendTest.isPending || dirty}
                title={dirty ? 'Save first — the test sends the stored template' : 'Send this template to your own email'}
              >
                <Send size={15} /> {sendTest.isPending ? 'Sending…' : 'Send test to me'}
              </Button>
              {!current?.isDefault && (
                <Button
                  variant="ghost"
                  onClick={() => save.mutate({ key: activeKey, subject: '', body: '' })}
                  disabled={save.isPending}
                >
                  <RotateCcw size={15} /> Reset to default
                </Button>
              )}
              {save.isSuccess && !save.isPending && <span className="text-sm text-green-600">Saved.</span>}
              {sendTest.isSuccess && !sendTest.isPending && (
                <span className="text-sm text-green-600">Test sent to {sendTest.data.to}.</span>
              )}
            </div>
            <ErrorNote error={save.error ?? sendTest.error} />
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800">Preview with sample data</h2>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 overflow-x-auto">
              <p className="text-sm font-semibold text-gray-800 break-words">{renderSample(subject)}</p>
              <hr className="my-3 border-gray-200" />
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-700">
                {renderSample(body)}
              </pre>
            </div>
            <p className="text-xs text-gray-400">
              Rendered client-side with representative values — real sends substitute live ticket data.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
