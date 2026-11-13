import { JobControls, JobRunner, RaahaRun } from '@/components/admin/Buttons';
import { IndofashionImporter } from '@/components/admin/IndofashionImporter';
import { one, sql } from '@/lib/db';
import { getSettings } from '@/lib/settings';

const usd = (v: unknown, d = 2) => `$${Number(v ?? 0).toFixed(d)}`;

export default async function Imports() {
  const s = await getSettings(true);
  const [jobs, c, mismatch] = await Promise.all([
    sql('select * from batch_jobs order by created_at desc limit 15'),
    one(`select count(*) filter (where source = 'raaha' and status = 'processed') as raaha_done,
                count(*) filter (where source = 'raaha' and status = 'pending') as raaha_pending,
                count(*) filter (where source = 'indofashion' and status = 'processed') as indo_done,
                count(*) filter (where source = 'indofashion' and status = 'pending') as indo_pending,
                (select coalesce(sum(cost_spent_usd), 0) from batch_jobs where kind = 'indofashion') as spent,
                (select coalesce(sum(done), 0) from batch_jobs where kind = 'indofashion') as processed
         from reference_outfits`),
    sql('select * from label_mismatch_summary()'),
  ]);
  const { raaha_done: raahaDone, raaha_pending: raahaPending, indo_done: indoDone, indo_pending: indoPending, spent, processed } = c;
  const perImage = processed ? spent / processed : null;
  const running = jobs.filter((j) => j.status === 'running').map((j) => j.id);

  return (
    <div className="space-y-8">
      <JobRunner ids={running} />
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Raaha catalogue</h1>
        <p className="text-sm text-muted">{raahaDone} products ready, {raahaPending} waiting. Pulled every night from {s.raaha_feed_url}</p>
        <RaahaRun defaultCap={s.raaha_nightly_cost_cap_usd} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">IndoFashion (internal only, never shown to guests)</h2>
        <p className="text-sm text-muted">{indoDone} images processed, {indoPending} waiting. Run a pilot of 500 first, review the mismatches, then load the larger batch, which waits below for your approval.</p>
        <IndofashionImporter defaultCap={s.default_import_cost_cap_usd} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="card"><p className="text-sm text-muted">Measured AI cost per image</p><p className="text-2xl font-semibold">{perImage == null ? 'n/a' : usd(perImage, 5)}</p></div>
          <div className="card"><p className="text-sm text-muted">Estimate for 10,000 images</p><p className="text-2xl font-semibold">{perImage == null ? 'Run the pilot first' : usd(perImage * 10000)}</p></div>
          <div className="card"><p className="text-sm text-muted">Spent so far</p><p className="text-2xl font-semibold">{usd(spent)}</p></div>
        </div>
        {mismatch.length > 0 && (
          <div className="card overflow-x-auto">
            <p className="mb-2 text-sm font-medium">Dataset label against the garment type the AI picked</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-1">Dataset label</th><th>Images</th><th>Mismatches</th><th>Not comparable</th><th>Mismatch rate</th></tr></thead>
              <tbody>{mismatch.map((m) => (
                <tr key={m.dataset_label} className="border-t border-line">
                  <td className="py-1">{m.dataset_label}</td><td>{m.total}</td><td>{m.mismatches}</td><td>{m.not_comparable}</td>
                  <td>{m.total - m.not_comparable ? `${Math.round((m.mismatches / (m.total - m.not_comparable)) * 100)}%` : 'n/a'}</td>
                </tr>
              ))}</tbody>
            </table>
            <a className="mt-2 inline-block text-sm underline" href="/admin/reference?source=indofashion&show=mismatch">Review the mismatches</a>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Batch jobs</h2>
        {!jobs.length && <p className="note">No jobs yet.</p>}
        {jobs.map((j) => {
          const share = j.total ? Math.min(1, (j.done + j.failed) / j.total) : 0;
          return (
            <div key={j.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><span className="font-medium capitalize">{j.kind.replace(/_/g, ' ')}</span>{j.params?.brand ? ` · ${j.params.brand}` : ''} · {new Date(j.created_at).toLocaleString('en-IN')}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${j.status === 'running' ? 'bg-[#e3f3ea] text-[#1f6143]' : j.status === 'done' ? 'bg-line' : 'bg-[#fdeed8] text-[#8a4a0c]'}`}>
                  {j.status === 'pending' ? (j.params?.uploading ? 'loading images' : 'waiting for approval') : j.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-3 rounded-full bg-brand transition-all" style={{ width: `${share * 100}%` }} />
              </div>
              <p className="text-sm text-muted">{j.done} of {j.total} done{j.failed ? `, ${j.failed} failed` : ''} · spent {usd(j.cost_spent_usd, 4)} of {usd(j.cost_cap_usd)} cap{j.last_error ? ` · last error: ${j.last_error}` : ''}</p>
              {j.status !== 'done' && !j.params?.uploading && <JobControls id={j.id} status={j.status} capUsd={Number(j.cost_cap_usd)} failed={j.failed} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}
