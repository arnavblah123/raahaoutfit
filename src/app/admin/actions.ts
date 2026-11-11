'use server';
import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { adminLogin, adminLogout, isAdmin } from '@/lib/admin';
import { isUuid, one, sql, transaction } from '@/lib/db';
import { normalise } from '@/lib/images';
import { labelMismatch } from '@/lib/indofashion';
import { loadAttributes, type ItemKind, type ItemRef } from '@/lib/items';
import { PermissionMissing, brandImport, raahaImport, recalcThreshold, vocabMergePass } from '@/lib/jobs';
import { judgeItems } from '@/lib/pipeline/match';
import { addStoredPhoto, createJob, removeBrand, runJob, setJobTotal } from '@/lib/reference';
import { DEFAULTS, getSettings, setSetting, type Settings } from '@/lib/settings';
import { loadVocab } from '@/lib/vocab';
import { clean } from '@/lib/weddings';

const ADMIN = 'admin';
async function admin() {
  if (!(await isAdmin())) throw new Error('Admin sign-in required');
  return ADMIN;
}
type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

// ------------------------------------------------------------------ login
export async function signIn(password: string): Promise<Result> {
  const error = await adminLogin(String(password ?? ''));
  return error ? { ok: false, error } : { ok: true };
}
export async function signOut() { await adminLogout(); }

// ------------------------------------------------------------------ item cards (photos + attributes)
export type Card = { kind: ItemKind; id: string; title: string; images: string[]; attributes: Record<string, string[]> };

async function card(ref: ItemRef): Promise<Card> {
  let images: string[] = [], title = 'Consented guest photo';
  if (ref.kind === 'reference') {
    const row = await one('select name, source from reference_outfits where id = $1', [ref.id]);
    title = row?.name || row?.source || '';
    const photos = await sql('select id, source_url, image is not null as stored from reference_photos where reference_outfit_id = $1 order by sort limit 2', [ref.id]);
    images = photos.map((p) => (p.stored ? `/api/admin/photo/reference/${p.id}` : p.source_url));
  } else if (ref.kind === 'training') {
    images = (await sql('select id from training_photos where training_outfit_id = $1 limit 2', [ref.id])).map((p) => `/api/admin/photo/training/${p.id}`);
  } else {
    // Guest photos reach the admin only when the guest ticked the consent box (the photo route checks again).
    images = (await sql(`select p.id from outfit_photos p join outfits o on o.id = p.outfit_id
                         where o.id = $1 and o.keep_for_training order by (p.kind = 'full') desc limit 2`, [ref.id])).map((p) => `/api/admin/photo/guest/${p.id}`);
  }
  return { ...ref, title, images: images.filter(Boolean), attributes: await loadAttributes(ref) };
}

// ------------------------------------------------------------------ reference review
export async function saveReferenceAttributes(id: string, selection: { group_id: string; value_ids: string[]; other: string }[]): Promise<Result<{ corrected: number }>> {
  try {
    const email = await admin();
    if (!isUuid(id)) throw new Error('Not found');
    const vocab = await loadVocab();
    const existing = await sql('select group_id, value_id, other_text from reference_attributes where reference_outfit_id = $1', [id]);
    const row = await one('select dataset_label from reference_outfits where id = $1', [id]);
    if (!row) throw new Error('Not found');
    let corrected = 0;
    await transaction(async (q) => {
      for (const g of vocab.groups) {
        const inc = selection.find((s) => s.group_id === g.id);
        if (!inc) continue;
        const ids = inc.value_ids.filter((v) => g.values.some((x) => x.id === v));
        const other = clean(inc.other, 120);
        const before = existing.filter((e) => e.group_id === g.id);
        const beforeKey = JSON.stringify([before.map((b) => b.value_id).filter(Boolean).sort(), before.map((b) => b.other_text).filter(Boolean).join(', ')]);
        if (beforeKey === JSON.stringify([[...ids].sort(), other])) continue;
        corrected++;
        const name = (v: string) => g.values.find((x) => x.id === v)?.value;
        await q('insert into attribute_corrections (reference_outfit_id, group_id, before, after, admin_email) values ($1, $2, $3::jsonb, $4::jsonb, $5)', [
          id, g.id, JSON.stringify({ values: before.map((b) => (b.value_id ? name(b.value_id) : b.other_text)) }),
          JSON.stringify({ values: [...ids.map(name), ...(other ? [other] : [])] }), email]);
        await q('delete from reference_attributes where reference_outfit_id = $1 and group_id = $2', [id, g.id]);
        for (const [i, v] of ids.entries()) {
          await q('insert into reference_attributes (reference_outfit_id, group_id, value_id, admin_corrected, position) values ($1, $2, $3, true, $4)', [id, g.id, v, i]);
        }
        if (other) {
          await q('insert into reference_attributes (reference_outfit_id, group_id, other_text, admin_corrected, position) values ($1, $2, $3, true, 99)', [id, g.id, other]);
          if (!g.free_text) await q(`select record_pending_value($1, $2, 'admin')`, [g.id, other]);
        }
        if (g.key === 'garment_type') {
          await q('update reference_outfits set garment_type_id = $2, label_mismatch = $3 where id = $1',
            [id, ids[0] ?? null, row.dataset_label ? labelMismatch(row.dataset_label, ids.map((v) => name(v) ?? '')) : null]);
        }
        if (g.key === 'colour') await q('update reference_outfits set colour_family_id = $2 where id = $1', [id, g.values.find((x) => x.id === ids[0])?.family_id ?? null]);
      }
      await q('update reference_outfits set reviewed_at = now() where id = $1', [id]);
    });
    return { ok: true, corrected };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ labelling
export type LabelTask = { left: Card; right: Card; similarity: number | null; why: string };
const LABELS = ['same_outfit', 'same_design_diff_colour', 'similar_look', 'different'];

export async function labelCounts() {
  await admin();
  const r = await one<{ total: number; today: number }>(
    `select count(*) as total, count(*) filter (where labelled_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as today
     from label_pairs where admin_label is not null`);
  return { total: r?.total ?? 0, today: r?.today ?? 0 };
}

/** Pairs picked by uncertainty: judge was not confident, or similarity sits closest to the threshold. */
export async function nextLabelPairs(n = 10): Promise<LabelTask[]> {
  await admin();
  const s = await getSettings();
  const tasks: LabelTask[] = [];
  // Judged guest pairs where the judge was not confident, both guests consented, and no label exists yet.
  const unsure = await sql(
    `select p.outfit_a_id, p.outfit_b_id, p.similarity from outfit_pairs p
     join outfits a on a.id = p.outfit_a_id and a.keep_for_training
     join outfits b on b.id = p.outfit_b_id and b.keep_for_training
     where p.verdict is not null and p.confidence <> 'high'
       and not exists (select 1 from label_pairs l where l.left_kind = 'guest' and l.left_id = p.outfit_a_id and l.right_kind = 'guest' and l.right_id = p.outfit_b_id)
     order by p.judged_at desc limit $1`, [Math.ceil(n / 3)]);
  for (const p of unsure) {
    tasks.push({
      left: await card({ kind: 'guest', id: p.outfit_a_id }), right: await card({ kind: 'guest', id: p.outfit_b_id }),
      similarity: p.similarity, why: 'judge_not_confident',
    });
  }
  const near = await sql('select * from label_candidates($1, $2, 150)', [s.judge_threshold, n - tasks.length]);
  for (const c of near) {
    tasks.push({
      left: await card({ kind: 'reference', id: c.left_id }), right: await card({ kind: 'reference', id: c.right_id }),
      similarity: c.similarity, why: 'near_threshold',
    });
  }
  return tasks;
}

export async function submitLabel(t: { left: ItemRef; right: ItemRef; similarity: number | null; why: string }, label: string): Promise<Result> {
  try {
    const email = await admin();
    if (!LABELS.includes(label) || !isUuid(t.left.id) || !isUuid(t.right.id)) throw new Error('Unknown label');
    const judged = t.left.kind === 'guest' && t.right.kind === 'guest'
      ? await one('select verdict, confidence from outfit_pairs where outfit_a_id = $1 and outfit_b_id = $2', [t.left.id, t.right.id]) : null;
    const row = (await one<{ id: string; judge_verdict: string | null }>(
      `insert into label_pairs (left_kind, left_id, right_kind, right_id, similarity, picked_reason, admin_label, admin_email, labelled_at, judge_verdict, judge_confidence)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
       on conflict (left_kind, left_id, right_kind, right_id) do update set
         admin_label = excluded.admin_label, admin_email = excluded.admin_email, labelled_at = now(),
         judge_verdict = coalesce(excluded.judge_verdict, label_pairs.judge_verdict),
         judge_confidence = coalesce(excluded.judge_confidence, label_pairs.judge_confidence)
       returning id, judge_verdict`,
      [t.left.kind, t.left.id, t.right.kind, t.right.id, t.similarity, t.why, label, email, judged?.verdict ?? null, judged?.confidence ?? null]))!;
    // Score the current pipeline on this pair so the dashboard can compare it with the label.
    if (!row.judge_verdict && (await getSettings()).judge_on_label) {
      after(async () => {
        try {
          const out = await judgeItems(t.left, t.right, {});
          await sql('update label_pairs set judge_verdict = $1, judge_confidence = $2 where id = $3', [out.verdict, out.confidence, row.id]);
        } catch (e) { console.error('judge on label failed', e); }
      });
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ vocabulary
export async function resolvePending(id: string, action: 'approve' | 'reject' | 'merge', targetId?: string): Promise<Result> {
  try {
    await admin();
    const p = await one('select group_id, normalised_value from attribute_pending where id = $1', [id]);
    if (!p) throw new Error('Not found');
    if (action === 'merge' && !isUuid(targetId)) throw new Error('Pick the value to merge into');
    await transaction(async (q) => {
      let valueId: string | null = action === 'merge' ? targetId! : null;
      if (action === 'approve') {
        valueId = (await q<{ id: string }>(`insert into attribute_values (group_id, value, origin, sort) values ($1, $2, 'promoted', 9999) returning id`, [p.group_id, p.normalised_value]))[0].id;
      }
      await q('update attribute_pending set status = $2, resolved_value_id = $3, resolved_at = now() where id = $1',
        [id, action === 'approve' ? 'approved' : action === 'merge' ? 'merged' : 'rejected', valueId]);
      if (valueId) {
        // Rows saved as free text now point at the real value.
        for (const table of ['outfit_attributes', 'reference_attributes']) {
          await q(`update ${table} set value_id = $1, other_text = null where group_id = $2 and value_id is null and lower(btrim(other_text)) = $3`, [valueId, p.group_id, p.normalised_value]);
        }
      }
    });
    await loadVocab(true);
    revalidatePath('/admin/vocabulary');
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function runVocabPass(): Promise<Result<{ suggested: number }>> {
  try { await admin(); const r = await vocabMergePass(); revalidatePath('/admin/vocabulary'); return { ok: true, suggested: r.suggested }; }
  catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ guest feedback
export async function labelFeedback(id: string, label: string): Promise<Result> {
  try {
    const email = await admin();
    if (!LABELS.includes(label)) throw new Error('Unknown label');
    const f = await one('update result_feedback set admin_label = $2 where id = $1 returning pair_snapshot', [id, label]);
    const a = f?.pair_snapshot?.reporter_outfit_id, b = f?.pair_snapshot?.other_outfit_id;
    if (isUuid(a) && isUuid(b)) {
      const [l, r] = a < b ? [a, b] : [b, a];
      const both = await one<{ n: number }>('select count(*) as n from outfits where id = any($1::uuid[])', [[l, r]]);
      if (both?.n === 2) {
        const j = f.pair_snapshot.judge ?? {};
        await sql(
          `insert into label_pairs (left_kind, left_id, right_kind, right_id, similarity, judge_verdict, judge_confidence, picked_reason, admin_label, admin_email, labelled_at)
           values ('guest', $1, 'guest', $2, $3, $4, $5, 'guest_feedback', $6, $7, now())
           on conflict (left_kind, left_id, right_kind, right_id) do update set admin_label = excluded.admin_label, admin_email = excluded.admin_email, labelled_at = now()`,
          [l, r, j.similarity ?? null, j.verdict ?? null, j.confidence ?? null, label, email]);
      }
    }
    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ imports and jobs
const cap = (v: unknown, fallback: number) => { const n = Number(v); return n > 0 && n <= 500 ? n : fallback; };

export async function runRaahaNow(costCap: number): Promise<Result<{ fresh: number; inFeed: number }>> {
  try {
    await admin();
    const s = await getSettings();
    const r = await raahaImport(cap(costCap, s.raaha_nightly_cost_cap_usd));
    after(() => runJob(r.job.id, Date.now() + 240_000).catch((e) => console.error(e)));
    revalidatePath('/admin/imports');
    return { ok: true, fresh: r.fresh, inFeed: r.inFeed };
  } catch (e) { return fail(e); }
}

export async function jobAction(id: string, action: 'start' | 'pause' | 'resume' | 'retry_failed', costCap?: number): Promise<Result> {
  try {
    await admin();
    const job = await one('select cost_cap_usd from batch_jobs where id = $1', [id]);
    if (!job) throw new Error('Job not found');
    if (action === 'retry_failed') {
      await sql(`update reference_outfits set status = 'pending' where batch_job_id = $1 and status = 'failed'`, [id]);
      await sql('update batch_jobs set failed = 0 where id = $1', [id]);
    }
    const status = action === 'pause' ? 'paused' : 'running';
    await sql(`update batch_jobs set status = $2, cost_cap_usd = $3, started_at = coalesce(started_at, now()) where id = $1`,
      [id, status, costCap != null ? cap(costCap, job.cost_cap_usd) : job.cost_cap_usd]);
    if (status === 'running') after(() => runJob(id, Date.now() + 240_000).catch((e) => console.error(e)));
    revalidatePath('/admin/imports');
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ partner brands
export async function saveBrand(form: FormData): Promise<Result> {
  try {
    await admin();
    const name = clean(form.get('name'), 80), feedType = String(form.get('feed_type'));
    if (!name || !['shopify', 'woocommerce', 'csv'].includes(feedType)) throw new Error('Name and feed type are required');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('permission_date'))) ? String(form.get('permission_date')) : null;
    const fields = [name, feedType, clean(form.get('feed_url'), 500) || null, date, clean(form.get('permission_note'), 1000) || null];
    let id = String(form.get('id') ?? '');
    if (isUuid(id)) {
      await sql('update partner_brands set name = $2, feed_type = $3, feed_url = $4, permission_date = $5, permission_note = $6 where id = $1', [id, ...fields]);
    } else {
      id = (await one<{ id: string }>('insert into partner_brands (name, feed_type, feed_url, permission_date, permission_note) values ($1, $2, $3, $4, $5) returning id', fields))!.id;
    }
    const file = form.get('permission_file');
    if (file instanceof File && file.size > 0) {
      if (file.size > 4_000_000) throw new Error('The permission file must be under 4 MB');
      await sql('update partner_brands set permission_file = $2, permission_file_name = $3 where id = $1',
        [id, Buffer.from(await file.arrayBuffer()), file.name.replace(/[^\w.-]/g, '_').slice(-80)]);
    }
    revalidatePath('/admin/brands');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function importBrand(form: FormData): Promise<Result<{ fresh: number; inFeed: number }>> {
  try {
    await admin();
    const s = await getSettings();
    const file = form.get('csv');
    const csv = file instanceof File && file.size > 0 ? await file.text() : undefined;
    const r = await brandImport(String(form.get('id')), cap(form.get('cost_cap'), s.default_import_cost_cap_usd), csv);
    after(() => runJob(r.job.id, Date.now() + 240_000).catch((e) => console.error(e)));
    revalidatePath('/admin/brands');
    return { ok: true, fresh: r.fresh, inFeed: r.inFeed };
  } catch (e) {
    if (e instanceof PermissionMissing) return { ok: false, error: e.message };
    return fail(e);
  }
}
export async function toggleBrand(id: string, on: boolean): Promise<Result> {
  try { await admin(); await sql('update partner_brands set show_in_similar = $2 where id = $1', [id, on]); revalidatePath('/admin/brands'); return { ok: true }; }
  catch (e) { return fail(e); }
}
export async function deleteBrand(id: string): Promise<Result<{ removed: number }>> {
  try { await admin(); const removed = await removeBrand(id); revalidatePath('/admin/brands'); return { ok: true, removed }; }
  catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ own stock
/** Several photos grouped as one outfit. One call per outfit keeps each request small. */
export async function uploadStockOutfit(form: FormData): Promise<Result<{ jobId: string }>> {
  try {
    await admin();
    const s = await getSettings();
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 4);
    if (!files.length) throw new Error('Add at least one photo');
    const jpegs = await Promise.all(files.map(async (f) => (await normalise(Buffer.from(await f.arrayBuffer()))).jpeg));
    const given = String(form.get('job_id') ?? '');
    const jobId = isUuid(given) ? given : (await createJob('own_stock', s.default_import_cost_cap_usd)).id;
    const row = (await one<{ id: string }>(
      `insert into reference_outfits (source, external_id, name, status, batch_job_id) values ('own_stock', $1, $2, 'pending', $3) returning id`,
      [randomUUID(), clean(form.get('name'), 200) || null, jobId]))!;
    for (const [sort, jpeg] of jpegs.entries()) await addStoredPhoto(row.id, jpeg, sort);
    await setJobTotal(jobId);
    return { ok: true, jobId };
  } catch (e) { return fail(e); }
}
export async function startStockJob(jobId: string): Promise<Result> {
  try { await admin(); after(() => runJob(jobId, Date.now() + 240_000).catch((e) => console.error(e))); return { ok: true }; }
  catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ settings
export async function saveSettings(values: Record<string, string>): Promise<Result> {
  try {
    await admin();
    for (const [k, raw] of Object.entries(values)) {
      if (!(k in DEFAULTS)) continue;
      const d = (DEFAULTS as any)[k];
      const v = typeof d === 'number' ? Number(raw) : typeof d === 'boolean' ? raw === 'true' : raw.trim();
      if (typeof d === 'number' && !Number.isFinite(v)) throw new Error(`${k} must be a number`);
      await setSetting(k as keyof Settings, v);
    }
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function runThresholdNow(): Promise<Result<{ old: number; next: number }>> {
  try { await admin(); const r = await recalcThreshold(); revalidatePath('/admin'); return { ok: true, old: r.old, next: r.next }; }
  catch (e) { return fail(e); }
}
