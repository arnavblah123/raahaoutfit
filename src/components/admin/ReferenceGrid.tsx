'use client';
import { useState } from 'react';
import { saveReferenceAttributes } from '@/app/admin/actions';
import type { VocabGroup } from '@/lib/vocab';

export type RefItem = {
  id: string; source: string; name: string | null; category: string | null; dataset_label: string | null; label_mismatch: boolean | null;
  status: string; reviewed: boolean; permalink: string | null; image: string;
  attributes: { group_id: string; value_id: string | null; other_text: string | null; admin_corrected: boolean }[];
};
type Sel = Record<string, { ids: string[]; other: string }>;

const toSel = (item: RefItem, groups: VocabGroup[]): Sel => Object.fromEntries(groups.map((g) => {
  const rows = item.attributes.filter((a) => a.group_id === g.id);
  return [g.id, { ids: rows.map((r) => r.value_id).filter((x): x is string => !!x), other: rows.map((r) => r.other_text).filter(Boolean).join(', ') }];
}));

export function ReferenceGrid({ items, groups }: { items: RefItem[]; groups: VocabGroup[] }) {
  if (!items.length) return <p className="note">Nothing here yet.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => <Card key={i.id} item={i} groups={groups} />)}
    </div>
  );
}

function Card({ item, groups }: { item: RefItem; groups: VocabGroup[] }) {
  const [sel, setSel] = useState<Sel>(() => toSel(item, groups));
  const [open, setOpen] = useState<string | null>(null);   // group being edited
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState(item.reviewed ? 'Reviewed' : '');
  const [busy, setBusy] = useState(false);

  const toggle = (g: string, id: string) => { setDirty(true); setSel((s) => ({ ...s, [g]: { ...s[g], ids: s[g].ids.includes(id) ? s[g].ids.filter((x) => x !== id) : [...s[g].ids, id] } })); };
  const other = (g: string, t: string) => { setDirty(true); setSel((s) => ({ ...s, [g]: { ...s[g], other: t } })); };
  async function save() {
    setBusy(true);
    const r = await saveReferenceAttributes(item.id, groups.map((g) => ({ group_id: g.id, value_ids: sel[g.id].ids, other: sel[g.id].other })));
    setBusy(false); setDirty(false); setOpen(null);
    setState(r.ok ? (r.corrected ? `Saved ${r.corrected} correction(s)` : 'Marked as correct') : r.error);
  }

  return (
    <div className="card space-y-2 p-3">
      <div className="flex gap-3">
        {item.image ? <img src={item.image} alt="" loading="lazy" className="h-40 w-28 shrink-0 rounded-xl object-cover" /> : <span className="h-40 w-28 shrink-0 rounded-xl bg-line" />}
        <div className="min-w-0 text-sm">
          <p className="line-clamp-2 font-medium">{item.name || '(no name)'}</p>
          <p className="text-muted">{item.source}{item.category ? ` · ${item.category}` : ''}</p>
          {item.dataset_label && (
            <p className={item.label_mismatch ? 'font-medium text-warn' : 'text-muted'}>
              Dataset label: {item.dataset_label}{item.label_mismatch ? ' (does not match)' : item.label_mismatch === null ? ' (not comparable)' : ''}
            </p>
          )}
          {item.status !== 'processed' && <p className="text-warn">{item.status.replace(/_/g, ' ')}</p>}
          {item.permalink && <a href={item.permalink} target="_blank" rel="noopener" className="underline">Product page</a>}
        </div>
      </div>
      <div className="space-y-1 text-sm">
        {groups.map((g) => {
          const s = sel[g.id];
          const names = [...s.ids.map((id) => g.values.find((v) => v.id === id)?.value ?? '?'), ...(s.other ? [s.other] : [])];
          return (
            <div key={g.id}>
              <button type="button" className="flex w-full gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-paper" onClick={() => setOpen(open === g.id ? null : g.id)}>
                <span className="w-32 shrink-0 text-muted">{g.label}</span>
                <span className={`capitalize ${names.length ? '' : 'text-muted/60'}`}>{names.join(', ') || 'blank'}</span>
              </button>
              {open === g.id && (
                <div className="my-1 space-y-2 rounded-xl border border-line p-2">
                  {!g.free_text && (
                    <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                      {g.values.map((v) => (
                        <button key={v.id} type="button" onClick={() => toggle(g.id, v.id)} className={`chip px-2 py-1 text-xs ${s.ids.includes(v.id) ? 'chip-on' : ''}`}>
                          {v.hex && <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-black/20 align-middle" style={{ background: v.hex }} />}{v.value}
                        </button>
                      ))}
                    </div>
                  )}
                  <input className="w-full rounded-lg border border-line px-2 py-1" placeholder={g.free_text ? 'Describe' : 'Other'} value={s.other} onChange={(e) => other(g.id, e.target.value)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : dirty ? 'Save corrections' : 'Looks right'}</button>
        <span className="text-xs text-muted">{state}</span>
      </div>
    </div>
  );
}
