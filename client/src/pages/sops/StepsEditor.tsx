/** Ordered checklist-step editor for runbooks: title, optional body, role hint, reorder, add/remove. */
import { ChevronDown, ChevronUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Input, Textarea } from '@/lib/ui';
import { draftFromStep, type SopStepDraft } from './shared';

export default function StepsEditor({
  steps,
  onChange,
  disabled,
}: {
  steps: SopStepDraft[];
  onChange: (steps: SopStepDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<SopStepDraft>) => {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <ListChecks size={14} className="text-gray-400" />
        <h2 className="text-sm font-semibold">Checklist steps</h2>
        <span className="text-xs text-gray-400">{steps.length}</span>
        <span className="flex-1" />
        {!disabled && (
          <Button variant="secondary" onClick={() => onChange([...steps, draftFromStep()])}>
            <Plus size={14} />
            Add step
          </Button>
        )}
      </div>

      {steps.length === 0 && (
        <p className="px-4 py-4 text-sm text-gray-400">
          No steps yet — each step becomes a checkbox with an audit trail when the runbook is run.
        </p>
      )}

      {steps.map((s, i) => (
        <div key={s.key} className="flex items-start gap-2.5 px-4 py-3 border-b border-gray-100 last:border-b-0">
          <span className="mt-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input
                value={s.title}
                onChange={(e) => update(i, { title: e.target.value })}
                disabled={disabled}
                placeholder="Step title — what to do"
                className="flex-1 min-w-[180px]"
              />
              <Input
                value={s.roleHint}
                onChange={(e) => update(i, { roleHint: e.target.value })}
                disabled={disabled}
                placeholder="Who does this? e.g. supervisor"
                className="w-full sm:w-52"
              />
            </div>
            <Textarea
              value={s.body}
              onChange={(e) => update(i, { body: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="Details (optional, markdown)"
              className="!text-[13px]"
            />
          </div>
          {!disabled && (
            <div className="flex shrink-0 flex-col items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                aria-label="Move step up"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                aria-label="Move step down"
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Remove step"
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
