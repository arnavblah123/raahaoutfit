import { json, one, sql } from '@/lib/db';
import { loadAttributes } from '@/lib/items';
import { ownOutfit } from '@/lib/outfits';
import { SEVERITY } from '@/lib/pipeline/match';
import { requireGuest } from '@/lib/session';
import { clean } from '@/lib/weddings';

/** "This result is wrong": store the pair and the guest's correction for admin review. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  if (!(await ownOutfit(r.guest, id))) return Response.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const result = await one('select verdict from outfit_results where outfit_id = $1', [id]);
  if (!result) return Response.json({ error: 'No result yet.' }, { status: 400 });
  const corrected = body.corrected_verdict in SEVERITY ? body.corrected_verdict : null;

  // The pair behind the shown verdict: the most severe judged pair for this outfit.
  const pairs = await sql('select * from outfit_pairs where outfit_a_id = $1 or outfit_b_id = $1', [id]);
  const pair = pairs.filter((p) => p.verdict && p.verdict !== 'no_clash')
    .sort((a, b) => SEVERITY[b.verdict as keyof typeof SEVERITY] - SEVERITY[a.verdict as keyof typeof SEVERITY])[0] ?? null;
  const other = pair ? (pair.outfit_a_id === id ? pair.outfit_b_id : pair.outfit_a_id) : null;
  const snapshot = {
    reporter: await loadAttributes({ kind: 'guest', id }),
    other: other ? await loadAttributes({ kind: 'guest', id: other }) : null,
    reporter_outfit_id: id, other_outfit_id: other,
    judge: pair ? { verdict: pair.verdict, confidence: pair.confidence, reason: pair.reason, similarity: pair.similarity } : null,
  };
  await sql(`insert into result_feedback (outfit_id, pair_id, shown_verdict, corrected_verdict, note, pair_snapshot) values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [id, pair?.id ?? null, result.verdict, corrected, clean(body.note, 300) || null, json(snapshot)]);
  return Response.json({ ok: true });
}
