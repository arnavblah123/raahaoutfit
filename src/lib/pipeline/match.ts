/**
 * Steps 2-4: shortlist, judge, and turn pair verdicts into what each guest sees.
 * A guest only ever reads outfit_results; outfit_pairs never leaves the server.
 */
import { createHash } from 'crypto';
import { one, sql } from '../db';
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
  const cases = await sql('select * from similar_labelled_cases($1, $2, $3, $4, 3)', [a.kind, a.id, b.kind, b.id]);
  const out: JudgeExample[] = [];
  for (const c of cases) {
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
  const existing = await one('select * from outfit_pairs where outfit_a_id = $1 and outfit_b_id = $2', [a, b]);
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
  await sql(
    `insert into outfit_pairs (outfit_a_id, outfit_b_id, similarity, shortlist_reason, verdict, confidence, reason, missing_evidence,
                               limiting_outfit_id, rounds, settled, judge_model, inputs_hash, judged_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     on conflict (outfit_a_id, outfit_b_id) do update set
       similarity = excluded.similarity, shortlist_reason = excluded.shortlist_reason, verdict = excluded.verdict,
       confidence = excluded.confidence, reason = excluded.reason, missing_evidence = excluded.missing_evidence,
       limiting_outfit_id = excluded.limiting_outfit_id, rounds = excluded.rounds, settled = excluded.settled,
       judge_model = excluded.judge_model, inputs_hash = excluded.inputs_hash, judged_at = now()`,
    [a, b, similarity, why, out.verdict, out.confidence, out.reason.slice(0, 300), out.missing_evidence.slice(0, 120),
      settled ? null : limiting, rounds, settled, models.judge, failed ? null : inputsHash]);
}

async function newerOf(a: string, b: string) {
  const rows = await sql('select id, confirmed_at from outfits where id = any($1::uuid[])', [[a, b]]);
  const ta = rows.find((r) => r.id === a)?.confirmed_at ?? '', tb = rows.find((r) => r.id === b)?.confirmed_at ?? '';
  return ta >= tb ? a : b;
}

const pairsOf = (outfitId: string) => sql('select * from outfit_pairs where outfit_a_id = $1 or outfit_b_id = $1', [outfitId]);
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
  const outfit = await one('select id, guest_id, confirmed_at, status from outfits where id = $1', [outfitId]);
  if (!outfit || outfit.status !== 'confirmed') return;
  const pairs = await pairsOf(outfitId);
  const partners = pairs.length
    ? await sql('select id, confirmed_at from outfits where id = any($1::uuid[])', [pairs.map((p) => partner(p, outfitId))]) : [];

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
  const open = await sql<{ id: string }>(`select id from photo_requests where outfit_id = $1 and status = 'open'`, [outfitId]);
  if (request) {
    if (open.length) await sql('update photo_requests set requested_photo = $1, kind = $2 where id = $3', [request.text, request.kind, open[0].id]);
    else await sql('insert into photo_requests (outfit_id, guest_id, kind, requested_photo) values ($1, $2, $3, $4)', [outfitId, outfit.guest_id, request.kind, request.text]);
  } else if (open.length) {
    await sql(`update photo_requests set status = 'closed' where id = any($1::uuid[])`, [open.map((o) => o.id)]);
  }

  const prev = await one('select verdict, seen_at from outfit_results where outfit_id = $1', [outfitId]);
  const isActor = actor === outfitId;
  const changed = !prev || prev.verdict !== best.display;
  // An earlier guest whose result changed sees it flagged the next time she opens her link.
  const seenAt = isActor ? new Date().toISOString() : changed ? null : prev.seen_at;
  await sql(
    `insert into outfit_results (outfit_id, guest_id, verdict, reason, state, seen_at, updated_at) values ($1, $2, $3, $4, $5, $6, now())
     on conflict (outfit_id) do update set verdict = excluded.verdict, reason = excluded.reason, state = excluded.state,
       seen_at = excluded.seen_at, updated_at = now()`,
    [outfitId, outfit.guest_id, best.display, best.reason, request?.kind === 'followup' ? 'needs_photo' : 'final', seenAt]);
}

/** Run after a guest confirms her attributes. */
export async function runMatch(outfitId: string) {
  const s = await getSettings();
  const shortlist = await sql('select * from shortlist_outfits($1, $2)', [outfitId, s.shortlist_top_k]);
  await Promise.all(shortlist.filter((c) => c.similarity >= s.judge_threshold).map((c) =>
    judgeGuestPair(outfitId, c.outfit_id, c.similarity, c.attr_match ? 'attributes+similarity' : 'similarity', outfitId, false)));
  // After an edit, pairs judged earlier are checked again. Unchanged inputs hit the cache and cost nothing.
  const fresh = new Set(shortlist.map((c) => c.outfit_id));
  await Promise.all((await pairsOf(outfitId)).filter((p) => !fresh.has(partner(p, outfitId))).map((p) =>
    judgeGuestPair(outfitId, partner(p, outfitId), p.similarity, p.shortlist_reason, outfitId, false)));
  await recomputeAround(outfitId, outfitId);
}

/** Run after a guest adds an extra photo: re-judge only her unsettled pairs. */
export async function rerunAfterExtraPhoto(outfitId: string) {
  await sql('update outfits set extra_rounds_used = extra_rounds_used + 1 where id = $1', [outfitId]);
  await sql(`update photo_requests set status = 'fulfilled' where outfit_id = $1 and status = 'open'`, [outfitId]);
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
  await sql(`delete from label_pairs where (left_kind = 'guest' and left_id = $1) or (right_kind = 'guest' and right_id = $1)`, [outfitId]);
  await sql('delete from outfits where id = $1', [outfitId]);   // cascades to photos, attributes, pairs, result, requests
  for (const id of partners) await recomputeResult(id, null);
}
