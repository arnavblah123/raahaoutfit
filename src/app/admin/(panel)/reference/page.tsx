import Link from 'next/link';
import { ReferenceGrid, type RefItem } from '@/components/admin/ReferenceGrid';
import { db } from '@/lib/db';
import { loadVocab } from '@/lib/vocab';

const PAGE = 24;
const pct = (v: number | null) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

export default async function ReferenceReview({ searchParams }: { searchParams: Promise<{ source?: string; show?: string; page?: string }> }) {
  const sp = await searchParams;
  const source = ['raaha', 'indofashion', 'partner', 'own_stock'].includes(sp.source ?? '') ? sp.source! : '';
  const show = sp.show ?? 'all';
  const page = Math.max(0, Number(sp.page) || 0);

  let q = db().from('reference_outfits')
    .select('id,source,name,category,dataset_label,label_mismatch,status,reviewed_at,permalink, reference_photos(storage_path,source_url,sort), reference_attributes(group_id,value_id,other_text,admin_corrected)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (source) q = q.eq('source', source);
  if (show === 'mismatch') q = q.eq('label_mismatch', true);
  else if (show === 'unreviewed') q = q.is('reviewed_at', null).eq('status', 'processed');
  else if (show === 'failed') q = q.in('status', ['failed', 'not_an_outfit']);
  else q = q.eq('status', 'processed');

  const [rows, vocab, blank, mismatches, reviewed, corrections] = await Promise.all([
    q, loadVocab(),
    db().rpc('reference_blank_share', { p_source: source || null }),
    db().from('reference_outfits').select('id', { count: 'exact', head: true }).eq('label_mismatch', true),
    db().from('reference_outfits').select('id', { count: 'exact', head: true }).not('reviewed_at', 'is', null),
    db().from('attribute_corrections').select('reference_outfit_id').limit(50000),
  ]);
  const items: RefItem[] = await Promise.all((rows.data ?? []).map(async (r: any) => {
    const p = r.reference_photos.sort((a: any, b: any) => a.sort - b.sort)[0];
    const image = !p ? '' : p.storage_path
      ? (await db().storage.from('reference').createSignedUrl(p.storage_path, 900)).data?.signedUrl ?? '' : p.source_url;
    return { id: r.id, source: r.source, name: r.name, category: r.category, dataset_label: r.dataset_label, label_mismatch: r.label_mismatch,
      status: r.status, reviewed: !!r.reviewed_at, permalink: r.permalink, image, attributes: r.reference_attributes };
  }));
  const correctedOutfits = new Set((corrections.data ?? []).map((c: any) => c.reference_outfit_id)).size;
  const link = (o: Record<string, string>) => `/admin/reference?${new URLSearchParams({ source, show, ...o })}`;
  const total = rows.count ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reference review</h1>
        <a href="/api/admin/export/reference" className="btn-ghost btn-sm">Export reference dataset (CSV)</a>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card"><p className="text-sm text-muted">Label mismatches</p><p className="text-2xl font-semibold">{mismatches.count ?? 0}</p></div>
        <div className="card"><p className="text-sm text-muted">Reviewed by me</p><p className="text-2xl font-semibold">{reviewed.count ?? 0}</p></div>
        <div className="card"><p className="text-sm text-muted">My correction rate</p><p className="text-2xl font-semibold">{pct(reviewed.count ? correctedOutfits / reviewed.count : null)}</p></div>
      </div>
      <details className="card">
        <summary className="cursor-pointer font-medium">Share of blank values per attribute{source ? ` (${source})` : ''}</summary>
        <div className="mt-3 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          {((blank.data ?? []) as any[]).map((b) => (
            <div key={b.group_key} className="flex items-center gap-2">
              <span className="w-44 shrink-0 text-muted">{b.group_label}</span>
              <span className="h-2 flex-1 rounded bg-line"><span className="block h-2 rounded bg-brand" style={{ width: `${(b.blank_share ?? 0) * 100}%` }} /></span>
              <span className="w-10 text-right tabular-nums">{pct(b.blank_share)}</span>
            </div>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap gap-2 text-sm">
        {[['', 'All sources'], ['raaha', 'Raaha'], ['partner', 'Partners'], ['own_stock', 'My stock'], ['indofashion', 'IndoFashion']].map(([v, l]) => (
          <Link key={v} href={link({ source: v, page: '0' })} className={`chip normal-case ${source === v ? 'chip-on' : ''}`}>{l}</Link>
        ))}
        <span className="mx-1 self-center text-muted">|</span>
        {[['all', 'Processed'], ['unreviewed', 'Not reviewed'], ['mismatch', 'Label mismatches'], ['failed', 'Failed or rejected']].map(([v, l]) => (
          <Link key={v} href={link({ show: v, page: '0' })} className={`chip normal-case ${show === v ? 'chip-on' : ''}`}>{l}</Link>
        ))}
      </div>
      <ReferenceGrid items={items} groups={vocab.groups} />
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{total} outfits · page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))}</span>
        <span className="flex gap-2">
          {page > 0 && <Link className="btn-ghost btn-sm" href={link({ page: String(page - 1) })}>Previous</Link>}
          {(page + 1) * PAGE < total && <Link className="btn-ghost btn-sm" href={link({ page: String(page + 1) })}>Next</Link>}
        </span>
      </div>
    </div>
  );
}
