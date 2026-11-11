/** Pipeline accuracy against admin labels. Pure, so it is unit-tested. */
export type LabelRow = { admin_label: string; judge_verdict: string | null; judge_confidence?: string | null; similarity: number | null };

const asLabel = (verdict: string) => (verdict === 'no_clash' ? 'different' : verdict);
export const LABEL_NAMES: Record<string, string> = {
  same_outfit: 'Same outfit', same_design_diff_colour: 'Same design, different colour', similar_look: 'Similar look', different: 'Different',
};

export function accuracy(rows: LabelRow[], threshold: number) {
  const judged = rows.filter((r) => r.judge_verdict);
  const exact = judged.filter((r) => asLabel(r.judge_verdict!) === r.admin_label).length;
  const isClash = (l: string) => l !== 'different';
  const tp = judged.filter((r) => isClash(r.admin_label) && isClash(asLabel(r.judge_verdict!))).length;
  const fp = judged.filter((r) => !isClash(r.admin_label) && isClash(asLabel(r.judge_verdict!))).length;
  const fn = judged.filter((r) => isClash(r.admin_label) && !isClash(asLabel(r.judge_verdict!))).length;
  const withSim = rows.filter((r) => r.similarity != null);
  const clashSim = withSim.filter((r) => isClash(r.admin_label));
  const confusion: Record<string, Record<string, number>> = {};
  for (const r of judged) {
    const row = (confusion[r.admin_label] ??= {});
    const k = asLabel(r.judge_verdict!);
    row[k] = (row[k] ?? 0) + 1;
  }
  const ratio = (a: number, b: number) => (b ? a / b : null);
  return {
    labelled: rows.length, judged: judged.length,
    exactAgreement: ratio(exact, judged.length),
    clashPrecision: ratio(tp, tp + fp), clashRecall: ratio(tp, tp + fn),
    // Share of human-labelled clashes the shortlist would have passed on to the judge.
    shortlistRecall: ratio(clashSim.filter((r) => r.similarity! >= threshold).length, clashSim.length),
    confusion,
  };
}
