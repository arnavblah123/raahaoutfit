/** Reference outfits (Raaha, partner brands, own stock, IndoFashion). Kept apart from guest data. */
import { db, must } from './db';
import { AiError } from './ai';
import { embedImage, embeddingModelTag, toPgVector } from './embed/server';
import type { FeedProduct } from './feeds';
import { labelMismatch } from './indofashion';
import { fetchImage } from './items';
import { runRead } from './pipeline/read';
import { logUsage } from './usage';
import { loadVocab } from './vocab';

export type Source = 'raaha' | 'indofashion' | 'partner' | 'own_stock';

/** Insert new products as pending and refresh listing fields on existing ones. Returns how many are new. */
export async function upsertProducts(source: Source, brandId: string | null, products: FeedProduct[], jobId: string | null) {
  let fresh = 0;
  for (const p of products) {
    if (!p.images.length) continue;
    let q = db().from('reference_outfits').select('id').eq('source', source).eq('external_id', p.external_id);
    q = brandId ? q.eq('brand_id', brandId) : q.is('brand_id', null);
    const existing = must(await q.maybeSingle()) as any;
    const fields = {
      sku: p.sku, name: p.name.slice(0, 300), price: p.price, currency: p.currency, description: p.description,
      permalink: p.permalink, category: p.category, updated_at: new Date().toISOString(),
    };
    if (existing) { await db().from('reference_outfits').update(fields).eq('id', existing.id); continue; }
    const row = must(await db().from('reference_outfits').insert({
      ...fields, source, brand_id: brandId, external_id: p.external_id, status: 'pending', batch_job_id: jobId,
    }).select('id').single(), 'insert product') as any;
    must(await db().from('reference_photos').insert(p.images.slice(0, 4).map((source_url, sort) => ({ reference_outfit_id: row.id, source_url, sort }))));
    fresh++;
  }
  return fresh;
}

async function photoBytes(p: { storage_path: string | null; source_url: string | null }) {
  if (p.storage_path) {
    const { data, error } = await db().storage.from('reference').download(p.storage_path);
    if (error || !data) throw new Error('Could not load stored reference photo');
    return Buffer.from(await data.arrayBuffer());
  }
  return fetchImage(p.source_url!);
}

/** Step 1 (Read) on the first image and Step 2 (embed) on every image of one reference outfit. Returns the AI cost. */
export async function processReference(id: string, jobId: string | null): Promise<number> {
  const row = must(await db().from('reference_outfits').select('*').eq('id', id).single()) as any;
  const photos = must(await db().from('reference_photos').select('id,storage_path,source_url,sort,embedding_model').eq('reference_outfit_id', id).order('sort')) as any[];
  if (!photos.length) throw new Error('No photos');
  const first = await photoBytes(photos[0]);
  const vocab = await loadVocab();
  let read;
  try {
    read = await runRead([first], [row.name, row.category].filter(Boolean).join(' / ') || undefined, vocab);
  } catch (e: any) {
    await logUsage(e?.usage, { reference_outfit_id: id, batch_job_id: jobId ?? undefined });
    throw e;
  }
  await logUsage(read.usage, { reference_outfit_id: id, batch_job_id: jobId ?? undefined });
  if (read.notOutfit) {
    await db().from('reference_outfits').update({ status: 'not_an_outfit', updated_at: new Date().toISOString() }).eq('id', id);
    return read.usage.cost_usd;
  }
  // Admin corrections are never overwritten by a re-read.
  const corrected = must(await db().from('reference_attributes').select('group_id').eq('reference_outfit_id', id).eq('admin_corrected', true)) as any[];
  const locked = new Set(corrected.map((c) => c.group_id));
  await db().from('reference_attributes').delete().eq('reference_outfit_id', id).eq('admin_corrected', false);
  const rows = read.suggestions.filter((s) => !locked.has(s.group_id)).flatMap((s) => [
    ...s.value_ids.map((value_id, i) => ({ value_id, other_text: null as string | null, position: i })),
    ...(s.other ? [{ value_id: null as string | null, other_text: s.other, position: 99 }] : []),
  ].map((x) => ({ ...x, reference_outfit_id: id, group_id: s.group_id, ai_confidence: s.confidence })));
  if (rows.length) must(await db().from('reference_attributes').insert(rows), 'save reference attributes');
  for (const p of read.proposals) await db().rpc('record_pending_value', { p_group: p.group_id, p_raw: p.value, p_by: 'ai' });

  const group = (key: string) => vocab.groups.find((g) => g.key === key)!;
  const garmentIds = read.suggestions.find((s) => s.group_key === 'garment_type')?.value_ids ?? [];
  const colourId = read.suggestions.find((s) => s.group_key === 'colour')?.value_ids[0];
  const garmentNames = garmentIds.map((v) => group('garment_type').values.find((x) => x.id === v)?.value ?? '');

  for (const [i, p] of photos.entries()) {
    const v = await embedImage(i === 0 ? first : await photoBytes(p));
    must(await db().from('reference_photos').update({ embedding: toPgVector(v), embedding_model: embeddingModelTag() }).eq('id', p.id), 'save embedding');
  }
  must(await db().from('reference_outfits').update({
    status: 'processed', updated_at: new Date().toISOString(),
    ...(locked.has(group('garment_type').id) ? {} : { garment_type_id: garmentIds[0] ?? null }),
    ...(locked.has(group('colour').id) ? {} : { colour_family_id: group('colour').values.find((x) => x.id === colourId)?.family_id ?? null }),
    label_mismatch: row.dataset_label ? labelMismatch(row.dataset_label, garmentNames) : null,
  }).eq('id', id), 'finish reference');
  return read.usage.cost_usd;
}

export async function createJob(kind: string, costCapUsd: number, params: Record<string, unknown> = {}, status: 'running' | 'pending' = 'running') {
  return must(await db().from('batch_jobs').insert({
    kind, cost_cap_usd: costCapUsd, params, status, started_at: status === 'running' ? new Date().toISOString() : null,
  }).select('*').single(), 'create job') as any;
}

/**
 * Work through one running job's pending rows until done, the cost cap is reached, or time runs out.
 * Safe to call again at any point: progress lives in the rows, so the batch is resumable.
 */
export async function runJob(jobId: string, deadline: number, onProgress?: (j: any) => void) {
  for (;;) {
    const job = must(await db().from('batch_jobs').select('*').eq('id', jobId).single()) as any;
    if (job.status !== 'running') return job;
    if (Number(job.cost_spent_usd) >= Number(job.cost_cap_usd)) {
      return must(await db().from('batch_jobs').update({ status: 'cap_reached' }).eq('id', jobId).select('*').single());
    }
    if (Date.now() > deadline) return job;
    const next = must(await db().from('reference_outfits').select('id').eq('batch_job_id', jobId).eq('status', 'pending').order('created_at').limit(4)) as any[];
    if (!next.length) {
      return must(await db().from('batch_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId).select('*').single());
    }
    const results = await Promise.all(next.map(async (r) => {
      try { return { ok: true, cost: await processReference(r.id, jobId) }; }
      catch (e: any) {
        await db().from('reference_outfits').update({ status: 'failed' }).eq('id', r.id);
        return { ok: false, cost: Number(e?.usage?.cost_usd ?? 0), error: e instanceof AiError ? e.message : String(e?.message ?? e) };
      }
    }));
    const failed = results.filter((r) => !r.ok);
    const updated = must(await db().from('batch_jobs').update({
      done: job.done + results.length - failed.length, failed: job.failed + failed.length,
      cost_spent_usd: Number(job.cost_spent_usd) + results.reduce((s, r) => s + r.cost, 0),
      ...(failed.length ? { last_error: (failed[0] as any).error?.slice(0, 300) } : {}),
    }).eq('id', jobId).select('*').single()) as any;
    onProgress?.(updated);
    // Stop a job that fails on everything rather than burning through the queue.
    if (updated.failed >= 20 && updated.done === 0) {
      return must(await db().from('batch_jobs').update({ status: 'failed' }).eq('id', jobId).select('*').single());
    }
  }
}

export async function setJobTotal(jobId: string) {
  const { count } = await db().from('reference_outfits').select('id', { count: 'exact', head: true }).eq('batch_job_id', jobId);
  await db().from('batch_jobs').update({ total: count ?? 0 }).eq('id', jobId);
  return count ?? 0;
}

/** One-click removal: every product, stored image and embedding of a brand. */
export async function removeBrand(brandId: string) {
  const outfits = must(await db().from('reference_outfits').select('id').eq('brand_id', brandId)) as any[];
  for (let i = 0; i < outfits.length; i += 100) {
    const ids = outfits.slice(i, i + 100).map((o) => o.id);
    const photos = must(await db().from('reference_photos').select('storage_path').in('reference_outfit_id', ids).not('storage_path', 'is', null)) as any[];
    if (photos.length) await db().storage.from('reference').remove(photos.map((p) => p.storage_path));
    await db().from('label_pairs').delete().eq('left_kind', 'reference').in('left_id', ids);
    await db().from('label_pairs').delete().eq('right_kind', 'reference').in('right_id', ids);
  }
  const brand = must(await db().from('partner_brands').select('permission_file_path').eq('id', brandId).maybeSingle()) as any;
  if (brand?.permission_file_path) await db().storage.from('permissions').remove([brand.permission_file_path]);
  must(await db().from('partner_brands').delete().eq('id', brandId), 'delete brand'); // cascades to outfits, photos, attributes
  return outfits.length;
}
