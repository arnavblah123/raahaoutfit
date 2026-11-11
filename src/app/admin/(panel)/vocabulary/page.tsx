import { PendingRow, VocabPassButton } from '@/components/admin/Buttons';
import { sql } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { loadVocab } from '@/lib/vocab';

export default async function Vocabulary() {
  const [vocab, s, rows] = await Promise.all([
    loadVocab(true), getSettings(),
    sql(`select * from attribute_pending where status = 'pending' order by occurrences desc limit 500`),
  ]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Vocabulary</h1>
        <VocabPassButton />
      </div>
      <p className="text-sm text-muted">
        New values typed by guests under "Other", or proposed by the AI, wait here. A value typed by guests {s.vocab_auto_promote_after} times is added automatically,
        unless the merge pass thinks it is a spelling of an existing value. The AI's own proposals never promote themselves.
      </p>
      {!rows.length && <p className="note">Nothing pending.</p>}
      {vocab.groups.filter((g) => rows.some((r) => r.group_id === g.id)).map((g) => (
        <section key={g.id} className="card">
          <h2 className="mb-1 text-lg font-semibold">{g.label}</h2>
          {rows.filter((r) => r.group_id === g.id).map((r) => (
            <PendingRow key={r.id} id={r.id} value={r.raw_value} occurrences={r.occurrences} by={r.proposed_by} suggestedId={r.suggested_merge_id}
              values={g.values.map((v) => ({ id: v.id, value: v.value }))} />
          ))}
        </section>
      ))}
    </div>
  );
}
