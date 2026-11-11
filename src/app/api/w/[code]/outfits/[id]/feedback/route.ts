import { db, must } from '@/lib/db';
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
  const result = must(await db().from('outfit_results').select('verdict').eq('outfit_id', id).maybeSingle()) as any;
  if (!result) return Response.json({ error: 'No result yet.' }, { status: 400 });
  const corrected = body.corrected_verdict in SEVERITY ? body.corrected_verdict : null;

  // The pair behind the shown verdict: the most severe judged pair for this outfit.
  const pairs = must(await db().from('outfit_pairs').select('*').or(`outfit_a_id.eq.${id},outfit_b_id.eq.${id}`)) as any[];
  const pair = pairs.filter((p) => p.verdict && p.verdict !== 'no_clash')
    .sort((a, b) => SEVERITY[b.verdict as keyof typeof SEVERITY] - SEVERITY[a.verdict as keyof typeof SEVERITY])[0] ?? null;
  const other = pair ? (pair.outfit_a_id === id ? pair.outfit_b_id : pair.outfit_a_id) : null;
  const snapshot = {
    reporter: await loadAttributes({ kind: 'guest', id }),
    other: other ? await loadAttributes({ kind: 'guest', id: other }) : null,
    reporter_outfit_id: id, other_outfit_id: other,
    judge: pair ? { verdict: pair.verdict, confidence: pair.confidence, reason: pair.reason, similarity: pair.similarity } : null,
  };
  must(await db().from('result_feedback').insert({
    outfit_id: id, pair_id: pair?.id ?? null, shown_verdict: result.verdict,
    corrected_verdict: corrected, note: clean(body.note, 300) || null, pair_snapshot: snapshot,
  }), 'save feedback');
  return Response.json({ ok: true });
}
