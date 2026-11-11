'use server';
import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { authClient, getAdmin } from '@/lib/admin';
import { db, must } from '@/lib/db';
import { env } from '@/lib/env';
import { normalise } from '@/lib/images';
import { labelMismatch } from '@/lib/indofashion';
import { loadAttributes, type ItemKind, type ItemRef } from '@/lib/items';
import { PermissionMissing, brandImport, raahaImport, recalcThreshold, vocabMergePass } from '@/lib/jobs';
import { judgeItems } from '@/lib/pipeline/match';
import { createJob, removeBrand, runJob, setJobTotal } from '@/lib/reference';
import { DEFAULTS, getSettings, setSetting, type Settings } from '@/lib/settings';
import { loadVocab } from '@/lib/vocab';
import { clean } from '@/lib/weddings';

async function admin() {
  const email = await getAdmin();
  if (!email) throw new Error('Admin sign-in required');
  return email;
}
type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

// ------------------------------------------------------------------ login
export async function sendMagicLink(emailRaw: string): Promise<Result> {
  const email = emailRaw.trim().toLowerCase();
  // Same answer whether or not the address is allowed, so the list cannot be probed.
  if (env.adminEmails.includes(email)) {
    const { error } = await (await authClient()).auth.signInWithOtp({ email, options: { emailRedirectTo: `${env.appUrl}/admin/auth/callback` } });
    if (error) return { ok: false, error: 'Could not send the email. Try again in a minute.' };
  }
  return { ok: true };
}
export async function signOut() { await (await authClient()).auth.signOut(); }

// ------------------------------------------------------------------ item cards (photos + attributes)
export type Card = { kind: ItemKind; id: string; title: string; images: string[]; attributes: Record<string, string[]> };

async function card(ref: ItemRef): Promise<Card> {
  const sign = async (bucket: string, path: string) => (await db().storage.from(bucket).createSignedUrl(path, 900)).data?.signedUrl ?? '';
  let images: string[] = [], title = '';
  if (ref.kind === 'reference') {
    const row = must(await db().from('reference_outfits').select('name,source, reference_photos(storage_path,source_url,sort)').eq('id', ref.id).single()) as any;
    title = row.name || row.source;
    images = await Promise.all(row.reference_photos.sort((a: any, b: any) => a.sort - b.sort).slice(0, 2)
      .map((p: any) => (p.storage_path ? sign('reference', p.storage_path) : p.source_url)));
  } else if (ref.kind === 'training') {
    const rows = must(await db().from('training_photos').select('storage_path').eq('training_outfit_id', ref.id)) as any[];
    images = await Promise.all(rows.slice(0, 2).map((p) => sign('training', p.storage_path)));
    title = 'Consented guest photo';
  } else {
    // Guest photos reach the admin only when the guest ticked the consent box.
    const o = must(await db().from('outfits').select('keep_for_training, outfit_photos(kind,storage_path)').eq('id', ref.id).single()) as any;
    if (o.keep_for_training) images = await Promise.all(o.outfit_photos.slice(0, 2).map((p: any) => sign('outfits', p.storage_path)));
    title = 'Consented guest photo';
  }
  return { ...ref, title, images: images.filter(Boolean), attributes: await loadAttributes(ref) };
}

// ------------------------------------------------------------------ reference review
export async function saveReferenceAttributes(id: string, selection: { group_id: string; value_ids: string[]; other: string }[]): Promise<Result<{ corrected: number }>> {
  try {
    const email = await admin();
    const vocab = await loadVocab();
    const existing = must(await db().from('reference_attributes').select('group_id,value_id,other_text').eq('reference_outfit_id', id)) as any[];
    let corrected = 0;
    const patch: Record<string, unknown> = { reviewed_at: new Date().toISOString() };
    for (const g of vocab.groups) {
      const inc = selection.find((s) => s.group_id === g.id);
      if (!inc) continue;
      const ids = inc.value_ids.filter((v) => g.values.some((x) => x.id === v));
      const other = clean(inc.other, 120);
      const before = existing.filter((e) => e.group_id === g.id);
      const beforeKey = JSON.stringify([before.map((b) => b.value_id).filter(Boolean).sort(), before.map((b) => b.other_text).filter(Boolean).join(', ')]);
      const afterKey = JSON.stringify([[...ids].sort(), other]);
      if (beforeKey === afterKey) continue;
      corrected++;
      const name = (v: string) => g.values.find((x) => x.id === v)?.value;
      must(await db().from('attribute_corrections').insert({
        reference_outfit_id: id, group_id: g.id, admin_email: email,
        before: { values: before.map((b) => (b.value_id ? name(b.value_id) : b.other_text)) },
        after: { values: [...ids.map(name), ...(other ? [other] : [])] },
      }), 'save correction');
      await db().from('reference_attributes').delete().eq('reference_outfit_id', id).eq('group_id', g.id);
      const rows = [
        ...ids.map((value_id, i) => ({ value_id, other_text: null as string | null, position: i })),
        ...(other ? [{ value_id: null as string | null, other_text: other, position: 99 }] : []),
      ].map((x) => ({ ...x, reference_outfit_id: id, group_id: g.id, admin_corrected: true }));
      if (rows.length) must(await db().from('reference_attributes').insert(rows), 'save attributes');
      if (other && !g.free_text) await db().rpc('record_pending_value', { p_group: g.id, p_raw: other, p_by: 'admin' });
      if (g.key === 'garment_type') {
        patch.garment_type_id = ids[0] ?? null;
        const row = must(await db().from('reference_outfits').select('dataset_label').eq('id', id).single()) as any;
        if (row.dataset_label) patch.label_mismatch = labelMismatch(row.dataset_label, ids.map((v) => name(v) ?? ''));
      }
      if (g.key === 'colour') patch.colour_family_id = g.values.find((x) => x.id === ids[0])?.family_id ?? null;
    }
    must(await db().from('reference_outfits').update(patch).eq('id', id), 'mark reviewed');
    return { ok: true, corrected };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ labelling
export type LabelTask = { left: Card; right: Card; similarity: number | null; why: string };
const LABELS = ['same_outfit', 'same_design_diff_colour', 'similar_look', 'different'];

export async function labelCounts() {
  await admin();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [{ count: total }, { count: todayCount }] = await Promise.all([
    db().from('label_pairs').select('id', { count: 'exact', head: true }).not('admin_label', 'is', null),
    db().from('label_pairs').select('id', { count: 'exact', head: true }).not('admin_label', 'is', null).gte('labelled_at', today.toISOString()),
  ]);
  return { total: total ?? 0, today: todayCount ?? 0 };
}

/** Pairs picked by uncertainty: judge was not confident, or similarity sits closest to the threshold. */
export async function nextLabelPairs(n = 10): Promise<LabelTask[]> {
  await admin();
  const s = await getSettings();
  const tasks: LabelTask[] = [];
  const unsure = must(await db().from('outfit_pairs')
    .select('outfit_a_id,outfit_b_id,similarity,confidence, a:outfits!outfit_pairs_outfit_a_id_fkey(keep_for_training), b:outfits!outfit_pairs_outfit_b_id_fkey(keep_for_training)')
    .neq('confidence', 'high').not('verdict', 'is', null).order('judged_at', { ascending: false }).limit(40)) as any[];
  for (const p of unsure) {
    if (tasks.length >= Math.ceil(n / 3)) break;
    if (!p.a?.keep_for_training || !p.b?.keep_for_training) continue;   // consented photos only
    const { count } = await db().from('label_pairs').select('id', { count: 'exact', head: true })
      .eq('left_kind', 'guest').eq('left_id', p.outfit_a_id).eq('right_kind', 'guest').eq('right_id', p.outfit_b_id);
    if (count) continue;
    tasks.push({
      left: await card({ kind: 'guest', id: p.outfit_a_id }), right: await card({ kind: 'guest', id: p.outfit_b_id }),
      similarity: p.similarity, why: 'judge_not_confident',
    });
  }
  const near = must(await db().rpc('label_candidates', { p_threshold: s.judge_threshold, p_n: n - tasks.length, p_sample: 150 })) as any[];
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
    if (!LABELS.includes(label)) throw new Error('Unknown label');
    let judged: any = null;
    if (t.left.kind === 'guest' && t.right.kind === 'guest') {
      judged = must(await db().from('outfit_pairs').select('verdict,confidence').eq('outfit_a_id', t.left.id).eq('outfit_b_id', t.right.id).maybeSingle());
    }
    const row = must(await db().from('label_pairs').upsert({
      left_kind: t.left.kind, left_id: t.left.id, right_kind: t.right.kind, right_id: t.right.id,
      similarity: t.similarity, picked_reason: t.why, admin_label: label, admin_email: email, labelled_at: new Date().toISOString(),
      ...(judged ? { judge_verdict: judged.verdict, judge_confidence: judged.confidence } : {}),
    }, { onConflict: 'left_kind,left_id,right_kind,right_id' }).select('id,judge_verdict').single(), 'save label') as any;
    // Score the current pipeline on this pair so the dashboard can compare it with the label.
    if (!row.judge_verdict && (await getSettings()).judge_on_label) {
      after(async () => {
        try {
          const out = await judgeItems(t.left, t.right, {});
          await db().from('label_pairs').update({ judge_verdict: out.verdict, judge_confidence: out.confidence }).eq('id', row.id);
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
    const p = must(await db().from('attribute_pending').select('*').eq('id', id).single()) as any;
    let valueId: string | null = null;
    if (action === 'approve') {
      valueId = (must(await db().from('attribute_values').insert({ group_id: p.group_id, value: p.normalised_value, origin: 'promoted', sort: 9999 }).select('id').single(), 'add value') as any).id;
    } else if (action === 'merge') {
      if (!targetId) throw new Error('Pick the value to merge into');
      valueId = targetId;
    }
    must(await db().from('attribute_pending').update({
      status: action === 'approve' ? 'approved' : action === 'merge' ? 'merged' : 'rejected',
      resolved_value_id: valueId, resolved_at: new Date().toISOString(),
    }).eq('id', id));
    if (valueId) {
      // Rows saved as free text now point at the real value.
      for (const table of ['outfit_attributes', 'reference_attributes']) {
        await db().from(table).update({ value_id: valueId, other_text: null }).eq('group_id', p.group_id).is('value_id', null).ilike('other_text', p.normalised_value);
      }
    }
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
    const f = must(await db().from('result_feedback').update({ admin_label: label }).eq('id', id).select('pair_snapshot').single()) as any;
    const a = f.pair_snapshot?.reporter_outfit_id, b = f.pair_snapshot?.other_outfit_id;
    if (a && b) {
      const [l, r] = a < b ? [a, b] : [b, a];
      const { count } = await db().from('outfits').select('id', { count: 'exact', head: true }).in('id', [l, r]);
      if (count === 2) {
        await db().from('label_pairs').upsert({
          left_kind: 'guest', left_id: l, right_kind: 'guest', right_id: r, similarity: f.pair_snapshot.judge?.similarity ?? null,
          judge_verdict: f.pair_snapshot.judge?.verdict ?? null, judge_confidence: f.pair_snapshot.judge?.confidence ?? null,
          picked_reason: 'guest_feedback', admin_label: label, admin_email: email, labelled_at: new Date().toISOString(),
        }, { onConflict: 'left_kind,left_id,right_kind,right_id' });
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
    const job = must(await db().from('batch_jobs').select('*').eq('id', id).single()) as any;
    const patch: Record<string, unknown> = {};
    if (costCap != null) patch.cost_cap_usd = cap(costCap, Number(job.cost_cap_usd));
    if (action === 'pause') patch.status = 'paused';
    if (action === 'start' || action === 'resume') { patch.status = 'running'; patch.started_at = job.started_at ?? new Date().toISOString(); }
    if (action === 'retry_failed') {
      await db().from('reference_outfits').update({ status: 'pending' }).eq('batch_job_id', id).eq('status', 'failed');
      patch.status = 'running'; patch.failed = 0;
    }
    must(await db().from('batch_jobs').update(patch).eq('id', id));
    if (patch.status === 'running') after(() => runJob(id, Date.now() + 240_000).catch((e) => console.error(e)));
    revalidatePath('/admin/imports');
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ partner brands
export async function saveBrand(form: FormData): Promise<Result> {
  try {
    await admin();
    const name = clean(form.get('name'), 80), feed_type = String(form.get('feed_type'));
    if (!name || !['shopify', 'woocommerce', 'csv'].includes(feed_type)) throw new Error('Name and feed type are required');
    const row: Record<string, unknown> = {
      name, feed_type, feed_url: clean(form.get('feed_url'), 500) || null,
      permission_date: /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('permission_date'))) ? form.get('permission_date') : null,
      permission_note: clean(form.get('permission_note'), 1000) || null,
    };
    const file = form.get('permission_file');
    if (file instanceof File && file.size > 0) {
      if (file.size > 4_000_000) throw new Error('The permission file must be under 4 MB');
      const path = `${randomUUID()}-${file.name.replace(/[^\w.-]/g, '_').slice(-80)}`;
      const up = await db().storage.from('permissions').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream' });
      if (up.error) throw new Error(up.error.message);
      row.permission_file_path = path;
    }
    const id = String(form.get('id') ?? '');
    must(id ? await db().from('partner_brands').update(row).eq('id', id) : await db().from('partner_brands').insert(row), 'save brand');
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
  try { await admin(); must(await db().from('partner_brands').update({ show_in_similar: on }).eq('id', id)); revalidatePath('/admin/brands'); return { ok: true }; }
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
    const jobId = String(form.get('job_id') ?? '');
    const job = jobId ? { id: jobId } : await createJob('own_stock', s.default_import_cost_cap_usd);
    const row = must(await db().from('reference_outfits').insert({
      source: 'own_stock', external_id: randomUUID(), name: clean(form.get('name'), 200) || null, sku: clean(form.get('sku'), 60) || null,
      status: 'pending', batch_job_id: job.id,
    }).select('id').single(), 'save outfit') as any;
    for (const [sort, f] of files.entries()) {
      const { jpeg } = await normalise(Buffer.from(await f.arrayBuffer()));
      const path = `own_stock/${row.id}/${sort}.jpg`;
      const up = await db().storage.from('reference').upload(path, jpeg, { contentType: 'image/jpeg' });
      if (up.error) throw new Error(up.error.message);
      must(await db().from('reference_photos').insert({ reference_outfit_id: row.id, storage_path: path, sort }));
    }
    await setJobTotal(job.id);
    return { ok: true, jobId: job.id };
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
