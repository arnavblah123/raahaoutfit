import { FeedbackButtons } from '@/components/admin/Buttons';
import { sql } from '@/lib/db';
import { VERDICT_LABEL } from '@/lib/weddings';

const Attrs = ({ title, a }: { title: string; a: Record<string, string[]> | null }) => (
  <div className="min-w-0 flex-1 rounded-xl border border-line p-2 text-xs">
    <p className="mb-1 font-medium">{title}</p>
    {a ? Object.entries(a).map(([k, v]) => <p key={k}><span className="text-muted">{k}: </span><span className="capitalize">{v.join(', ')}</span></p>)
      : <p className="text-muted">Deleted</p>}
  </div>
);

export default async function Feedback() {
  const data = await sql('select * from result_feedback order by created_at desc limit 200');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Guest reports: "This result is wrong"</h1>
      <p className="text-sm text-muted">Confirmed attributes only; guest photos are not shown here. Your decision is saved as a label and feeds the judge examples, the threshold and the dashboard.</p>
      {!data.length && <p className="note">No reports yet.</p>}
      {data.map((f) => (
        <div key={f.id} className="card space-y-2">
          <p className="text-sm">
            Shown: <span className="font-medium">{VERDICT_LABEL[f.shown_verdict] ?? f.shown_verdict}</span>
            {f.corrected_verdict && <> · Guest says: <span className="font-medium">{VERDICT_LABEL[f.corrected_verdict] ?? f.corrected_verdict}</span></>}
            <span className="text-muted"> · {new Date(f.created_at).toLocaleDateString('en-IN')}</span>
          </p>
          {f.note && <p className="text-sm italic">"{f.note}"</p>}
          {f.pair_snapshot?.judge && <p className="text-xs text-muted">Judge: {f.pair_snapshot.judge.verdict} ({f.pair_snapshot.judge.confidence}). {f.pair_snapshot.judge.reason}</p>}
          {f.pair_snapshot ? (
            <div className="flex gap-2"><Attrs title="Reporting guest's outfit" a={f.pair_snapshot.reporter} /><Attrs title="Other outfit" a={f.pair_snapshot.other} /></div>
          ) : <p className="text-xs text-muted">Outfit details were deleted with the wedding.</p>}
          <FeedbackButtons id={f.id} current={f.admin_label} />
        </div>
      ))}
    </div>
  );
}
