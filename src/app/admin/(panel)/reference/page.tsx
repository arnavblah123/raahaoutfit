import Link from 'next/link';
import { ReferenceGrid, type RefItem } from '@/components/admin/ReferenceGrid';
import { one, sql } from '@/lib/db';
import { loadVocab } from '@/lib/vocab';

const PAGE = 24;
const pct = (v: number | null) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

export default async function ReferenceReview({ searchParams }: { searchParams: Promise<{ source?: string; show?: string; page?: string }> }) {
  const sp = await searchParams;
  const source = ['raaha', 'indofashion', 'partner', 'own_stock'].includes(sp.source ?? '') ? sp.source! : '';
  const show = sp.show ?? 'all';
  const page = Math.max(0, Number(sp.page) || 0);

  const where = [
    source ? 'r.source = $1' : '$1::text is null',
    show === 'mismatch' ? 'r.label_mismatch' : show === 'unreviewed' ? `r.reviewed_at is null and r.status = 'processed'`
      : show === 'failed' ? `r.status in ('failed','not_an_outfit')` : `r.status = 'processed'`,
  ].join(' and ');
  const [rows, vocab, blank, stats] = await Promise.all([
    sql(
      `select r.id, r.source, r.name, r.category, r.dataset_label, r.label_mismatch, r.status, r.reviewed_at, r.permalink,
              count(*) over () as total,
              (select case when p.image is not null then '/api/admin/photo/reference/' || p.id else p.source_url end
               from reference_photos p where p.reference_outfit_id = r.id order by p.sort limit 1) as image,
              coalesce((select jsonb_agg(jsonb_build_object('group_id', a.group_id, 'value_id', a.value_id, 'other_text', a.other_text, 'admin_corrected', a.admin_corrected) order by a.position)
                        from reference_attributes a where a.reference_outfit_id = r.id), '[]'::jsonb) as attributes
       from reference_outfits r where ${where} order by r.created_at desc, r.id limit ${PAGE} offset $2`, [source || null, page * PAGE]),
    loadVocab(),
    sql('select * from reference_blank_share($1)', [source || null]),
    one(`select (select count(*) from reference_outfits where label_mismatch) as mismatches,
                (select count(*) from reference_outfits where reviewed_at is not null) as reviewed,
                (select count(distinct reference_outfit_id) from attribute_corrections) as corrected`),
  ]);
  const items: RefItem[] = rows.map((r) => ({
    id: r.id, source: r.source, name: r.name, category: r.category, dataset_label: r.dataset_label, label_mismatch: r.label_mismatch,
    status: r.status, reviewed: !!r.reviewed_at, permalink: r.permalink, image: r.image ?? '', attributes: r.attributes,
  }));
  const total = rows[0]?.total ?? 0;
  const link = (o: Record<string, string>) => `/admin/reference?${new URLSearchParams({ source, show, ...o })}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reference review</h1>
        <a href="/api/admin/export/reference" className="btn-ghost btn-sm">Export reference dataset (CSV)</a>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card"><p className="text-sm text-muted">Label mismatches</p><p className="text-2xl font-semibold">{stats.mismatches}</p></div>
        <div className="card"><p className="text-sm text-muted">Reviewed by me</p><p className="text-2xl font-semibold">{stats.reviewed}</p></div>
        <div className="card"><p className="text-sm text-muted">My correction rate</p><p className="text-2xl font-semibold">{pct(stats.reviewed ? stats.corrected / stats.reviewed : null)}</p></div>
      </div>
      <details className="card">
        <summary className="cursor-pointer font-medium">Share of blank values per attribute{source ? ` (${source})` : ''}</summary>
        <div className="mt-3 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          {blank.map((b) => (
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
