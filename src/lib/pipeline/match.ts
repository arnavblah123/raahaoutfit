/**
 * Steps 2-4: shortlist, judge, and turn pair verdicts into what each guest sees.
 * A guest only ever reads outfit_results; outfit_pairs never leaves the server.
 */
import { createHash } from 'crypto';
import { db, must } from '../db';
import { judgePair as aiJudge, models, PROMPT_VERSION, type JudgeExample, type JudgeOutput } from '../ai';
import { loadAttributes, loadSide, type ItemRef } from '../items';
import { getSettings } from '../settings';
import { logUsage, type UsageCtx } from '../usage';

export type Display = 'same_outfit' | 'same_design_diff_colour' | 'similar_look' | 'possible_clash' | 'no_clash';
export const SEVERITY: Record<Display, number> = {
  no_clash: 0, possible_clash: 1, similar_look: 2, same_design_diff_colour: 3, same_outfit: 4,
};
const POSSIBLE_REASON = 'Another outfit at this function may be close to yours. The photos were not clear enough to be sure.';

/** Retrieve the reviewer-decided cases closest to this pair, as examples for the judge. */
async function examplesFor(a: ItemRef, b: ItemRef): Promise<JudgeExample[]> {
  const { data } = await db().rpc('similar_labelled_cases', { p_a_kind: a.kind, p_a: a.id, p_b_kind: b.kind, p_b: b.id, p_n: 3 });
  const out: JudgeExample[] = [];
  for (const c of data ?? []) {
    try {
      const [l, r] = await Promise.all([
        loadAttributes({ kind: c.left_kind, id: c.left_id }), loadAttributes({ kind: c.right_kind, id: c.right_id }),
      ]);
      out.push({ a: l, b: r, label: c.admin_label === 'different' ? 'no_clash' : c.admin_label });
    } catch { /* an example that cannot be loaded is simply skipped */ }
  }
  return out;
}

/** Judge any two items (guest, reference or training). Logs token usage. */
export async function judgeItems(a: ItemRef, b: ItemRef, ctx: UsageCtx): Promise<JudgeOutput & { inputsHash: string }> {
  const [sa, sb, examples] = await Promise.all([loadSide(a), loadSide(b), examplesFor(a, b)]);
  const inputsHash = hashInputs(sa.key, sb.key);
  try {
    const { data, usage } = await aiJudge(sa, sb, examples);
    await logUsage(usage, ctx);
    return { ...data, inputsHash };
  } catch (e: any) {
    await logUsage(e?.usage, ctx);
    throw e;
  }
}

const hashInputs = (ka: string, kb: string) =>
  createHash('sha256').update([PROMPT_VERSION, models.judge, ka, kb].join('|')).digest('hex');

async function judgeGuestPair(x: string, y: string, similarity: number, why: string, actor: string, bumpRound: boolean) {
  const s = await getSettings();
  const [a, b] = x < y ? [x, y] : [y, x];
  const existing = must(await db().from('outfit_pairs').select('*').eq('outfit_a_id', a).eq('outfit_b_id', b).maybeSingle()) as any;
  const [sa, sb] = await Promise.all([loadSide({ kind: 'guest', id: a }), loadSide({ kind: 'guest', id: b })]);
  const inputsHash = hashInputs(sa.key, sb.key);
  if (existing?.verdict && existing.inputs_hash === inputsHash) return; // cached per pair

  const examples = await examplesFor({ kind: 'guest', id: a }, { kind: 'guest', id: b });
  let out: JudgeOutput;
  let failed = false;
  try {
    const res = await aiJudge(sa, sb, examples);
    await logUsage(res.usage, { outfit_id: actor });
    out = res.data;
  } catch (e: any) {
    await logUsage(e?.usage, { outfit_id: actor });
    // The judge could not answer. Never invent a verdict: record an unsettled low-confidence pair.
    failed = true; // no inputs hash is stored, so the next run tries again
    out = { verdict: 'similar_look', confidence: 'low', reason: '', missing_evidence: '', limiting_side: 'none' };
  }
  const rounds = (existing?.rounds ?? 0) + (existing && bumpRound ? 1 : 0);
  const newer = await newerOf(a, b);
  const limiting = out.verdict === 'no_clash' || out.confidence === 'high' || !out.missing_evidence.trim() ? null
    : out.limiting_side === 'A' ? a : out.limiting_side === 'B' ? b : out.limiting_side === 'both' ? newer : null;
  const settled = out.verdict === 'no_clash' || out.confidence === 'high' || !limiting || rounds >= s.max_extra_rounds;
  must(await db().from('outfit_pairs').upsert({
    outfit_a_id: a, outfit_b_id: b, similarity, shortlist_reason: why,
    verdict: out.verdict, confidence: out.confidence, reason: out.reason.slice(0, 300),
    missing_evidence: out.missing_evidence.slice(0, 120), limiting_outfit_id: settled ? null : limiting,
    rounds, settled, judge_model: models.judge, inputs_hash: failed ? null : inputsHash, judged_at: new Date().toISOString(),
  }, { onConflict: 'outfit_a_id,outfit_b_id' }), 'save pair');
}

async function newerOf(a: string, b: string) {
  const rows = must(await db().from('outfits').select('id,confirmed_at').in('id', [a, b])) as any[];
  const ta = rows.find((r) => r.id === a)?.confirmed_at ?? '', tb = rows.find((r) => r.id === b)?.confirmed_at ?? '';
  return ta >= tb ? a : b;
}

const pairsOf = async (outfitId: string) =>
  must(await db().from('outfit_pairs').select('*').or(`outfit_a_id.eq.${outfitId},outfit_b_id.eq.${outfitId}`)) as any[];
const partner = (p: any, me: string) => (p.outfit_a_id === me ? p.outfit_b_id : p.outfit_a_id);

/** What one side of a judged pair should be shown. Pure, so it can be unit-tested. */
export function displayFor(p: { verdict: string | null; confidence: string | null; settled: boolean; limiting_outfit_id: string | null },
  me: string, iAmNewer: boolean): { display: Display | null; needsPhoto: boolean } {
  if (!p.verdict || p.verdict === 'no_clash') return { display: null, needsPhoto: false };
  if (p.settled) return { display: p.confidence === 'high' ? (p.verdict as Display) : 'possible_clash', needsPhoto: false };
  // Unsettled: the later uploader sees a provisional "possible clash"; the earlier guest
  // sees nothing yet (at most a neutral request for a clearer photo).
  return { display: iAmNewer ? 'possible_clash' : null, needsPhoto: p.limiting_outfit_id === me };
}

/** Rebuild the single result row a guest sees for one outfit. */
export async function recomputeResult(outfitId: string, actor: string | null) {
  const outfit = must(await db().from('outfits').select('id,guest_id,confirmed_at,status').eq('id', outfitId).maybeSingle()) as any;
  if (!outfit || outfit.status !== 'confirmed') return;
  const pairs = await pairsOf(outfitId);
  const partners = pairs.length
    ? must(await db().from('outfits').select('id,confirmed_at').in('id', pairs.map((p) => partner(p, outfitId)))) as any[] : [];

  let best: { display: Display; reason: string } = { display: 'no_clash', reason: 'No one else at this function has added a similar outfit so far.' };
  let request: { text: string; kind: 'followup' | 'neutral_clarity' } | null = null;
  for (const p of pairs) {
    const other = partners.find((o) => o.id === partner(p, outfitId));
    const iAmNewer = (outfit.confirmed_at ?? '') >= (other?.confirmed_at ?? '');
    const d = displayFor(p, outfitId, iAmNewer);
    if (d.needsPhoto && !request) request = { text: p.missing_evidence, kind: iAmNewer ? 'followup' : 'neutral_clarity' };
    if (d.display && SEVERITY[d.display] > SEVERITY[best.display]) {
      best = { display: d.display, reason: d.display === 'possible_clash' ? POSSIBLE_REASON : (p.reason || POSSIBLE_REASON) };
    }
  }

  // Keep exactly one open photo request in step with the pairs.
  const open = must(await db().from('photo_requests').select('id').eq('outfit_id', outfitId).eq('status', 'open')) as any[];
  if (request) {
    if (open.length) await db().from('photo_requests').update({ requested_photo: request.text, kind: request.kind }).eq('id', open[0].id);
    else await db().from('photo_requests').insert({ outfit_id: outfitId, guest_id: outfit.guest_id, kind: request.kind, requested_photo: request.text });
  } else if (open.length) {
    await db().from('photo_requests').update({ status: 'closed' }).in('id', open.map((o) => o.id));
  }

  const prev = must(await db().from('outfit_results').select('verdict,seen_at').eq('outfit_id', outfitId).maybeSingle()) as any;
  const isActor = actor === outfitId;
  const changed = !prev || prev.verdict !== best.display;
  must(await db().from('outfit_results').upsert({
    outfit_id: outfitId, guest_id: outfit.guest_id, verdict: best.display, reason: best.reason,
    state: request?.kind === 'followup' ? 'needs_photo' : 'final',
    // An earlier guest whose result changed sees it flagged the next time she opens her link.
    seen_at: isActor ? new Date().toISOString() : changed ? null : prev.seen_at,
    updated_at: new Date().toISOString(),
  }), 'save result');
}

/** Run after a guest confirms her attributes. */
export async function runMatch(outfitId: string) {
  const s = await getSettings();
  const shortlist = must(await db().rpc('shortlist_outfits', { p_outfit: outfitId, p_top: s.shortlist_top_k })) as any[];
  await Promise.all(shortlist.filter((c) => c.similarity >= s.judge_threshold).map((c) =>
    judgeGuestPair(outfitId, c.outfit_id, c.similarity, c.attr_match ? 'attributes+similarity' : 'similarity', outfitId, false)));
  await recomputeAround(outfitId, outfitId);
}

/** Run after a guest adds an extra photo: re-judge only her unsettled pairs. */
export async function rerunAfterExtraPhoto(outfitId: string) {
  const outfit = must(await db().from('outfits').select('extra_rounds_used').eq('id', outfitId).single()) as any;
  await db().from('outfits').update({ extra_rounds_used: outfit.extra_rounds_used + 1 }).eq('id', outfitId);
  await db().from('photo_requests').update({ status: 'fulfilled' }).eq('outfit_id', outfitId).eq('status', 'open');
  await Promise.all((await pairsOf(outfitId)).filter((p) => !p.settled).map((p) =>
    judgeGuestPair(outfitId, partner(p, outfitId), p.similarity, p.shortlist_reason, outfitId, true)));
  await recomputeAround(outfitId, outfitId);
}

export async function recomputeAround(outfitId: string, actor: string | null) {
  const ids = new Set<string>([outfitId]);
  for (const p of await pairsOf(outfitId)) ids.add(partner(p, outfitId));
  for (const id of ids) await recomputeResult(id, actor);
}

/** Remove an outfit completely: photos, vectors, attributes, pairs, result. */
export async function deleteOutfit(outfitId: string) {
  const partners = (await pairsOf(outfitId)).map((p) => partner(p, outfitId));
  const photos = must(await db().from('outfit_photos').select('storage_path').eq('outfit_id', outfitId)) as any[];
  if (photos.length) await db().storage.from('outfits').remove(photos.map((p) => p.storage_path));
  must(await db().from('outfits').delete().eq('id', outfitId), 'delete outfit');
  for (const id of partners) await recomputeResult(id, null);
}
