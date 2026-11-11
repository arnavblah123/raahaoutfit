'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteBrand, importBrand, jobAction, labelFeedback, resolvePending, runRaahaNow, runThresholdNow, runVocabPass, saveBrand, saveSettings, toggleBrand } from '@/app/admin/actions';
import { LABEL_NAMES } from '@/lib/accuracy';

/** Runs a server action, shows its message, refreshes the page data. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const run = (fn: () => Promise<any>, done?: (r: any) => string) => start(async () => {
    setMsg('');
    const r = await fn();
    setMsg(r?.ok === false ? r.error : done ? done(r) : '');
    router.refresh();
  });
  return { pending, msg, run };
}
const Msg = ({ text }: { text: string }) => (text ? <span className="text-sm text-muted">{text}</span> : null);

export function ThresholdButton() {
  const a = useAction();
  return <span className="flex items-center gap-2"><Msg text={a.msg} />
    <button className="btn-ghost btn-sm" disabled={a.pending} onClick={() => a.run(runThresholdNow, (r) => `${r.old} → ${r.next}`)}>Recalculate now</button></span>;
}

export function VocabPassButton() {
  const a = useAction();
  return <span className="flex items-center gap-2"><Msg text={a.msg} />
    <button className="btn-ghost btn-sm" disabled={a.pending} onClick={() => a.run(runVocabPass, (r) => `${r.suggested} merge suggestion(s)`)}>{a.pending ? 'Running…' : 'Run merge pass now'}</button></span>;
}

export function PendingRow({ id, value, occurrences, by, suggestedId, values }: {
  id: string; value: string; occurrences: number; by: string; suggestedId: string | null; values: { id: string; value: string }[];
}) {
  const a = useAction();
  const [target, setTarget] = useState(suggestedId ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm">
      <span className="min-w-40 font-medium">{value}</span>
      <span className="text-muted">{occurrences}× · {by}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-line bg-white px-2 py-1.5" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Merge into…</option>
          {values.map((v) => <option key={v.id} value={v.id}>{v.value}{v.id === suggestedId ? ' (suggested)' : ''}</option>)}
        </select>
        <button className="btn-ghost btn-sm" disabled={a.pending || !target} onClick={() => a.run(() => resolvePending(id, 'merge', target))}>Merge</button>
        <button className="btn-primary btn-sm" disabled={a.pending} onClick={() => a.run(() => resolvePending(id, 'approve'))}>Approve as new</button>
        <button className="btn-ghost btn-sm" disabled={a.pending} onClick={() => a.run(() => resolvePending(id, 'reject'))}>Reject</button>
      </span>
      <Msg text={a.msg} />
    </div>
  );
}

export function FeedbackButtons({ id, current }: { id: string; current: string | null }) {
  const a = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Object.entries(LABEL_NAMES).map(([k, label]) => (
        <button key={k} className={`chip normal-case ${current === k ? 'chip-on' : ''}`} disabled={a.pending} onClick={() => a.run(() => labelFeedback(id, k))}>{label}</button>
      ))}
      <Msg text={a.msg} />
    </div>
  );
}

export function RaahaRun({ defaultCap }: { defaultCap: number }) {
  const a = useAction();
  const [cap, setCap] = useState(String(defaultCap));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm text-muted">Cost cap (USD)</label>
      <input className="w-24 rounded-lg border border-line bg-white px-2 py-1.5" value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" />
      <button className="btn-primary btn-sm" disabled={a.pending} onClick={() => a.run(() => runRaahaNow(Number(cap)), (r) => `${r.inFeed} products in the feed, ${r.fresh} new`)}>{a.pending ? 'Pulling…' : 'Pull Raaha now'}</button>
      <Msg text={a.msg} />
    </div>
  );
}

export function JobControls({ id, status, capUsd, failed }: { id: string; status: string; capUsd: number; failed: number }) {
  const a = useAction();
  const [cap, setCap] = useState(String(capUsd));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-muted">Cap $</label>
      <input className="w-20 rounded-lg border border-line bg-white px-2 py-1 text-sm" value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" />
      {status === 'pending' && <button className="btn-primary btn-sm" disabled={a.pending} onClick={() => a.run(() => jobAction(id, 'start', Number(cap)))}>Approve and start</button>}
      {status === 'running' && <button className="btn-ghost btn-sm" disabled={a.pending} onClick={() => a.run(() => jobAction(id, 'pause'))}>Pause</button>}
      {(status === 'paused' || status === 'cap_reached' || status === 'failed') && <button className="btn-primary btn-sm" disabled={a.pending} onClick={() => a.run(() => jobAction(id, 'resume', Number(cap)))}>Resume</button>}
      {failed > 0 && status !== 'running' && <button className="btn-ghost btn-sm" disabled={a.pending} onClick={() => a.run(() => jobAction(id, 'retry_failed', Number(cap)))}>Retry {failed} failed</button>}
      <Msg text={a.msg} />
    </div>
  );
}

export function BrandForm({ brand }: { brand?: any }) {
  const a = useAction();
  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run(() => saveBrand(f), () => 'Saved'); }}>
      {brand && <input type="hidden" name="id" value={brand.id} />}
      <div><label className="label">Brand name</label><input name="name" className="field" required defaultValue={brand?.name} /></div>
      <div><label className="label">Feed type</label>
        <select name="feed_type" className="field" defaultValue={brand?.feed_type ?? 'shopify'}>
          <option value="shopify">Shopify products.json</option><option value="woocommerce">WooCommerce Store API</option><option value="csv">CSV upload</option>
        </select></div>
      <div className="md:col-span-2"><label className="label">Feed URL (not needed for CSV)</label>
        <input name="feed_url" className="field" placeholder="https://brand.com/products.json" defaultValue={brand?.feed_url ?? ''} /></div>
      <div><label className="label">Permission received on</label><input name="permission_date" type="date" className="field" defaultValue={brand?.permission_date ?? ''} /></div>
      <div><label className="label">Permission email or letter (file)</label><input name="permission_file" type="file" className="field" />
        {brand?.has_file && <p className="mt-1 text-xs text-muted">On record: {brand.permission_file_name}</p>}</div>
      <div className="md:col-span-2"><label className="label">Permission note (who agreed, and to what)</label>
        <textarea name="permission_note" className="field" rows={2} defaultValue={brand?.permission_note ?? ''} /></div>
      <div className="flex items-center gap-3 md:col-span-2"><button className="btn-primary btn-sm" disabled={a.pending}>{brand ? 'Save changes' : 'Add brand'}</button><Msg text={a.msg} /></div>
    </form>
  );
}

export function BrandActions({ brand, defaultCap, hasPermission }: { brand: any; defaultCap: number; hasPermission: boolean }) {
  const a = useAction();
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run(() => importBrand(f), (r) => `${r.inFeed} products in the feed, ${r.fresh} new. Processing has started.`); }}>
        <input type="hidden" name="id" value={brand.id} />
        {brand.feed_type === 'csv' && <input name="csv" type="file" accept=".csv,text/csv" required className="text-sm" />}
        <label className="text-sm text-muted">Cost cap (USD)</label>
        <input name="cost_cap" className="w-20 rounded-lg border border-line bg-white px-2 py-1.5" defaultValue={defaultCap} inputMode="decimal" />
        <button className="btn-primary btn-sm" disabled={a.pending || !hasPermission} title={hasPermission ? '' : 'Add permission details first'}>{a.pending ? 'Importing…' : 'Run import'}</button>
      </form>
      {!hasPermission && <p className="text-sm text-warn">Import is blocked: no permission on file for this brand.</p>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" defaultChecked={brand.show_in_similar} onChange={(e) => a.run(() => toggleBrand(brand.id, e.target.checked))} />
          Show in "See similar styles"
        </label>
        <button className="text-warn underline" disabled={a.pending} onClick={() => {
          if (confirm(`Remove ${brand.name}? This deletes all of its products, images and embeddings.`)) a.run(() => deleteBrand(brand.id), (r) => `Removed ${r.removed} products`);
        }}>Remove brand and all its data</button>
      </div>
      <Msg text={a.msg} />
    </div>
  );
}

export function SettingsEditor({ values }: { values: Record<string, unknown> }) {
  const a = useAction();
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      a.run(() => saveSettings(Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]))), () => 'Saved');
    }}>
      {Object.entries(values).map(([k, v]) => (
        <div key={k} className="grid items-center gap-2 md:grid-cols-[18rem_1fr]">
          <label className="text-sm text-muted" htmlFor={k}>{k.replace(/_/g, ' ')}</label>
          {typeof v === 'boolean'
            ? <select id={k} name={k} className="field" defaultValue={String(v)}><option value="true">on</option><option value="false">off</option></select>
            : <input id={k} name={k} className="field" defaultValue={String(v)} />}
        </div>
      ))}
      <div className="flex items-center gap-3"><button className="btn-primary btn-sm" disabled={a.pending}>Save settings</button><Msg text={a.msg} /></div>
    </form>
  );
}

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t); }, [router, seconds]);
  return null;
}
