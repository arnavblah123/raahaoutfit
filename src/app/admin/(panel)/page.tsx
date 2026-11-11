import { ThresholdButton } from '@/components/admin/Buttons';
import { LABEL_NAMES, accuracy } from '@/lib/accuracy';
import { one, sql } from '@/lib/db';
import { getSettings } from '@/lib/settings';

const pct = (v: number | null) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const usd = (v: unknown) => (v == null ? 'n/a' : `$${Number(v).toFixed(4)}`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default async function Dashboard() {
  const s = await getSettings(true);
  const [labels, c, log, counts] = await Promise.all([
    sql('select admin_label, judge_verdict, judge_confidence, similarity from label_pairs where admin_label is not null'),
    one('select * from cost_per_outfit(30)'),
    sql('select * from threshold_log order by created_at desc limit 8'),
    one(`select (select count(*) from reference_outfits where reviewed_at is not null) as reviewed,
                (select count(distinct reference_outfit_id) from attribute_corrections) as corrected,
                (select count(*) from weddings where purged_at is null) as weddings,
                (select count(*) from outfits where status = 'confirmed') as outfits,
                (select count(*) from result_feedback where admin_label is null) as feedback`),
  ]);
  const a = accuracy(labels as any, s.judge_threshold);
  const order = ['same_outfit', 'same_design_diff_colour', 'similar_look', 'different'];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Pipeline accuracy against your labels</h1>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Exact verdict agreement" value={pct(a.exactAgreement)} sub={`${a.judged} labelled pairs judged`} />
          <Stat label="Clash recall" value={pct(a.clashRecall)} sub="Real clashes the judge caught" />
          <Stat label="Clash precision" value={pct(a.clashPrecision)} sub="Judge clashes that were real" />
          <Stat label="Shortlist recall" value={pct(a.shortlistRecall)} sub={`At threshold ${s.judge_threshold}`} />
        </div>
        {a.judged > 0 && (
          <div className="card overflow-x-auto">
            <p className="mb-2 text-sm font-medium">Your label (rows) against the judge (columns)</p>
            <table className="w-full text-sm">
              <thead><tr><th />{order.map((o) => <th key={o} className="px-2 py-1 text-right font-medium text-muted">{LABEL_NAMES[o]}</th>)}</tr></thead>
              <tbody>{order.map((r) => (
                <tr key={r} className="border-t border-line">
                  <td className="py-1 pr-2 text-muted">{LABEL_NAMES[r]}</td>
                  {order.map((o) => <td key={o} className={`px-2 py-1 text-right tabular-nums ${r === o ? 'font-semibold' : ''}`}>{a.confusion[r]?.[o] ?? 0}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {a.labelled === 0 && <p className="note">No labels yet. Use the Label page; these numbers update as you go.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Cost and activity</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="AI cost per outfit (30 days)" value={usd(c?.avg_cost)} sub={`Read ${usd(c?.avg_read)} · Judge ${usd(c?.avg_judge)}`} />
          <Stat label="Outfits costed (30 days)" value={String(c?.outfits ?? 0)} sub={`Total ${usd(c?.total)}`} />
          <Stat label="Active weddings" value={String(counts.weddings)} sub={`${counts.outfits} confirmed outfits`} />
          <Stat label="My correction rate" value={pct(counts.reviewed ? counts.corrected / counts.reviewed : null)} sub={`${counts.corrected} corrected of ${counts.reviewed} reviewed`} />
        </div>
        {counts.feedback > 0 && <p className="note">{counts.feedback} guest report(s) of a wrong result are waiting on the Feedback page.</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shortlist threshold: {s.judge_threshold}</h2>
          <ThresholdButton />
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-1">When</th><th>Old</th><th>New</th><th>Labels used</th><th>Note</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-1">{new Date(l.created_at).toLocaleString('en-IN')}</td><td>{l.old_value}</td><td>{l.new_value}</td>
                  <td>{l.sample_size}</td><td className="text-muted">{l.metric?.note ?? (l.metric?.changed ? 'Changed' : 'No change')}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan={5} className="py-2 text-muted">Recalculated every week from your labels. No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
