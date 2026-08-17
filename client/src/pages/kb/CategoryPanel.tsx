/**
 * Category tree side panel: filter articles by category, plus inline
 * add / rename / delete and per-category audience (agents and up only).
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Input, Select, cx } from '@/lib/ui';
import { ALL_AUDIENCES, AUDIENCE_META, type Audience, type KbCategory } from './shared';

type EditorState = { mode: 'add'; parentId: string | null } | { mode: 'edit'; id: string };

export default function CategoryPanel({
  categories,
  isLoading,
  selectedId,
  onSelect,
  canEdit,
}: {
  categories: KbCategory[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [name, setName] = useState('');
  const [aud, setAud] = useState<Audience>('public');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kb'] });

  const save = useMutation({
    mutationFn: () => {
      if (editor?.mode === 'edit') {
        return api.patch(`/api/kb/categories/${editor.id}`, { name: name.trim(), audience: aud });
      }
      return api.post('/api/kb/categories', {
        name: name.trim(),
        audience: aud,
        parentId: editor?.mode === 'add' ? (editor.parentId ?? undefined) : undefined,
      });
    },
    onSuccess: () => {
      setEditor(null);
      setError(null);
      void invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save category'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/kb/categories/${id}`),
    onSuccess: (_d, id) => {
      if (selectedId === id) onSelect(null);
      setError(null);
      void invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not delete category'),
  });

  const openAdd = (parentId: string | null) => {
    setEditor({ mode: 'add', parentId });
    setName('');
    setAud('public');
    setError(null);
  };
  const openEdit = (cat: KbCategory) => {
    setEditor({ mode: 'edit', id: cat.id });
    setName(cat.name);
    setAud(cat.audience);
    setError(null);
  };

  const sortCats = (list: KbCategory[]) =>
    [...list].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const roots = sortCats(categories.filter((c) => !c.parentId));
  const childrenOf = (id: string) => sortCats(categories.filter((c) => c.parentId === id));

  const form = (
    <div className="px-2 py-2 space-y-1.5 bg-gray-50 rounded-lg my-1">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) save.mutate();
          if (e.key === 'Escape') setEditor(null);
        }}
      />
      <Select value={aud} onChange={(e) => setAud(e.target.value as Audience)} className="w-full">
        {ALL_AUDIENCES.map((a) => (
          <option key={a} value={a}>
            {AUDIENCE_META[a].label}
          </option>
        ))}
      </Select>
      <div className="flex gap-1.5">
        <Button
          className="!px-2.5 !py-1 text-xs"
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {editor?.mode === 'edit' ? 'Save' : 'Create'}
        </Button>
        <Button variant="ghost" className="!px-2.5 !py-1 text-xs" onClick={() => setEditor(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  const renderNode = (cat: KbCategory, depth: number): ReactNode => {
    const editing = editor?.mode === 'edit' && editor.id === cat.id;
    const adding = editor?.mode === 'add' && editor.parentId === cat.id;
    return (
      <div key={cat.id}>
        {editing ? (
          <div style={{ marginLeft: depth * 12 }}>{form}</div>
        ) : (
          <div
            className={cx(
              'group flex items-center gap-1 rounded-lg pr-1.5 py-1.5',
              selectedId === cat.id ? 'bg-brand-soft' : 'hover:bg-gray-50'
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <button
              onClick={() => onSelect(selectedId === cat.id ? null : cat.id)}
              className={cx(
                'flex-1 min-w-0 text-left text-sm truncate',
                selectedId === cat.id ? 'text-brand font-medium' : 'text-gray-700'
              )}
              title={cat.name}
            >
              {cat.name}
            </button>
            <Badge color={AUDIENCE_META[cat.audience]?.color ?? 'gray'} className="!px-1.5 !text-[10px]">
              {AUDIENCE_META[cat.audience]?.label ?? cat.audience}
            </Badge>
            {canEdit && (
              <span className="hidden group-hover:flex items-center shrink-0">
                <IconBtn title="Add subcategory" onClick={() => openAdd(cat.id)}>
                  <Plus size={13} />
                </IconBtn>
                <IconBtn title="Rename / audience" onClick={() => openEdit(cat)}>
                  <Pencil size={12} />
                </IconBtn>
                <IconBtn
                  title="Delete category"
                  onClick={() => {
                    if (window.confirm(`Delete category "${cat.name}"? Its articles keep existing without it.`)) {
                      remove.mutate(cat.id);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </IconBtn>
              </span>
            )}
          </div>
        )}
        {adding && <div style={{ marginLeft: (depth + 1) * 12 }}>{form}</div>}
        {childrenOf(cat.id).map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <Card className="p-2">
      <div className="flex items-center justify-between px-2 py-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Categories</h2>
        {canEdit && (
          <IconBtn title="New category" onClick={() => openAdd(null)}>
            <FolderPlus size={14} />
          </IconBtn>
        )}
      </div>
      {editor?.mode === 'add' && editor.parentId === null && form}
      <button
        onClick={() => onSelect(null)}
        className={cx(
          'w-full text-left rounded-lg px-2 py-1.5 text-sm',
          selectedId === null ? 'bg-brand-soft text-brand font-medium' : 'text-gray-700 hover:bg-gray-50'
        )}
      >
        All articles
      </button>
      {isLoading && <p className="px-2 py-3 text-xs text-gray-400">Loading…</p>}
      {!isLoading && roots.length === 0 && (
        <p className="px-2 py-3 text-xs text-gray-400">No categories yet.</p>
      )}
      {roots.map((cat) => renderNode(cat, 0))}
      {error && <p className="px-2 py-1.5 text-xs text-red-600">{error}</p>}
    </Card>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
    >
      {children}
    </button>
  );
}
