/** Reference outfits (Raaha, partner brands, own stock, IndoFashion). Kept apart from guest data. */
import { json, one, sql } from './db';
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
    const fields = [p.sku, p.name.slice(0, 300), p.price, p.currency, p.description, p.permalink, p.category];
    const existing = await one<{ id: string }>(
      'select id from reference_outfits where source = $1 and external_id = $2 and brand_id is not distinct from $3', [source, p.external_id, brandId]);
    if (existing) {
      await sql(`update reference_outfits set sku = $2, name = $3, price = $4, currency = $5, description = $6, permalink = $7,
                 category = $8, updated_at = now() where id = $1`, [existing.id, ...fields]);
      continue;
    }
    const row = await one<{ id: string }>(
      `insert into reference_outfits (source, brand_id, external_id, sku, name, price, currency, description, permalink, category, status, batch_job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11) returning id`, [source, brandId, p.external_id, ...fields, jobId]);
    for (const [sort, url] of p.images.slice(0, 4).entries()) {
      await sql('insert into reference_photos (reference_outfit_id, source_url, sort) values ($1, $2, $3)', [row!.id, url, sort]);
    }
    fresh++;
  }
  return fresh;
}

/** Stored reference photos are kept small: they are for review and embedding, not display to guests. */
export async function addStoredPhoto(referenceOutfitId: string, jpeg: Buffer, sort: number) {
  await sql('insert into reference_photos (reference_outfit_id, image, sort) values ($1, $2, $3)', [referenceOutfitId, jpeg, sort]);
}

/** Step 1 (Read) on the first image and Step 2 (embed) on every image of one reference outfit. Returns the AI cost. */
export async function processReference(id: string, jobId: string | null): Promise<number> {
  const row = await one('select name, category, dataset_label from reference_outfits where id = $1', [id]);
  const photos = await sql<{ id: string; image: Buffer | null; source_url: string | null; embedded: boolean }>(
    'select id, image, source_url, embedding is not null as embedded from reference_photos where reference_outfit_id = $1 order by sort', [id]);
  if (!row || !photos.length) throw new Error('No photos');
  const bytes = (p: (typeof photos)[number]) => (p.image ? Promise.resolve(p.image) : fetchImage(p.source_url!));
  const first = await bytes(photos[0]);
  const vocab = await loadVocab();
  const ctx = { reference_outfit_id: id, batch_job_id: jobId ?? undefined };
  let read;
  try {
    read = await runRead([first], [row.name, row.category].filter(Boolean).join(' / ') || undefined, vocab);
  } catch (e: any) {
    await logUsage(e?.usage, ctx);
    throw e;
  }
  await logUsage(read.usage, ctx);
  if (read.notOutfit) {
    await sql(`update reference_outfits set status = 'not_an_outfit', updated_at = now() where id = $1`, [id]);
    return read.usage.cost_usd;
  }
  // Admin corrections are never overwritten by a re-read.
  const locked = new Set((await sql<{ group_id: string }>(
    'select distinct group_id from reference_attributes where reference_outfit_id = $1 and admin_corrected', [id])).map((c) => c.group_id));
  await sql('delete from reference_attributes where reference_outfit_id = $1 and not admin_corrected', [id]);
  for (const s of read.suggestions.filter((x) => !locked.has(x.group_id))) {
    for (const [i, valueId] of s.value_ids.entries()) {
      await sql('insert into reference_attributes (reference_outfit_id, group_id, value_id, ai_confidence, position) values ($1, $2, $3, $4, $5)', [id, s.group_id, valueId, s.confidence, i]);
    }
    if (s.other) await sql('insert into reference_attributes (reference_outfit_id, group_id, other_text, ai_confidence, position) values ($1, $2, $3, $4, 99)', [id, s.group_id, s.other, s.confidence]);
  }
  for (const p of read.proposals) await sql(`select record_pending_value($1, $2, 'ai')`, [p.group_id, p.value]);

  const group = (key: string) => vocab.groups.find((g) => g.key === key)!;
  const garmentIds = read.suggestions.find((s) => s.group_key === 'garment_type')?.value_ids ?? [];
  const colourId = read.suggestions.find((s) => s.group_key === 'colour')?.value_ids[0];
  const garmentNames = garmentIds.map((v) => group('garment_type').values.find((x) => x.id === v)?.value ?? '');

  for (const [i, p] of photos.entries()) {
    if (p.embedded) continue;   // the admin's browser already computed this vector during upload
    const v = await embedImage(i === 0 ? first : await bytes(p));
    await sql('update reference_photos set embedding = $1::vector, embedding_model = $2 where id = $3', [toPgVector(v), embeddingModelTag(), p.id]);
  }
  await sql(
    `update reference_outfits set status = 'processed', updated_at = now(), label_mismatch = $2,
       garment_type_id = case when $3 then garment_type_id else $4::uuid end,
       colour_family_id = case when $5 then colour_family_id else $6::uuid end
     where id = $1`,
    [id, row.dataset_label ? labelMismatch(row.dataset_label, garmentNames) : null,
      locked.has(group('garment_type').id), garmentIds[0] ?? null,
      locked.has(group('colour').id), group('colour').values.find((x) => x.id === colourId)?.family_id ?? null]);
  return read.usage.cost_usd;
}

export async function createJob(kind: string, costCapUsd: number, params: Record<string, unknown> = {}, status: 'running' | 'pending' = 'running') {
  return (await one(
    `insert into batch_jobs (kind, cost_cap_usd, params, status, started_at) values ($1, $2, $3::jsonb, $4, case when $4 = 'running' then now() end) returning *`,
    [kind, costCapUsd, json(params), status]))!;
}

/**
 * Work through one running job's pending rows until done, the cost cap is reached, or time runs out.
 * Safe to call again at any point: progress lives in the rows, so the batch is resumable.
 */
export async function runJob(jobId: string, deadline: number, onProgress?: (j: any) => void) {
  const setStatus = (status: string) => one(
    `update batch_jobs set status = $2, finished_at = case when $2 = 'done' then now() else finished_at end where id = $1 returning *`, [jobId, status]);
  for (;;) {
    const job = await one('select * from batch_jobs where id = $1', [jobId]);
    if (!job || job.status !== 'running') return job;
    if (job.cost_spent_usd >= job.cost_cap_usd) return setStatus('cap_reached');
    if (Date.now() > deadline) return job;
    // Claim a few rows. Rows claimed by a worker that died are released after ten minutes.
    await sql(`update reference_outfits set status = 'pending' where batch_job_id = $1 and status = 'processing' and updated_at < now() - interval '10 minutes'`, [jobId]);
    const next = await sql<{ id: string }>(
      `update reference_outfits set status = 'processing', updated_at = now()
       where id in (select id from reference_outfits where batch_job_id = $1 and status = 'pending' order by created_at limit 4 for update skip locked)
       returning id`, [jobId]);
    if (!next.length) {
      // Nothing left to claim. If another worker is still busy with the last rows, let it finish the job.
      const busy = await one(`select 1 from reference_outfits where batch_job_id = $1 and status = 'processing' limit 1`, [jobId]);
      return busy ? job : setStatus('done');
    }
    const results = await Promise.all(next.map(async (r) => {
      try { return { ok: true, cost: await processReference(r.id, jobId), error: '' }; }
      catch (e: any) {
        await sql(`update reference_outfits set status = 'failed' where id = $1`, [r.id]);
        return { ok: false, cost: Number(e?.usage?.cost_usd ?? 0), error: e instanceof AiError ? e.message : String(e?.message ?? e) };
      }
    }));
    const failed = results.filter((r) => !r.ok);
    const updated = await one(
      `update batch_jobs set done = done + $2, failed = failed + $3, cost_spent_usd = cost_spent_usd + $4,
         last_error = coalesce($5, last_error) where id = $1 returning *`,
      [jobId, results.length - failed.length, failed.length, results.reduce((s, r) => s + r.cost, 0), failed[0]?.error.slice(0, 300) ?? null]);
    onProgress?.(updated);
    // Stop a job that fails on everything rather than burning through the queue.
    if (updated.failed >= 20 && updated.done === 0) return setStatus('failed');
  }
}

export async function setJobTotal(jobId: string) {
  const r = await one<{ total: number }>(
    'update batch_jobs set total = (select count(*) from reference_outfits where batch_job_id = $1) where id = $1 returning total', [jobId]);
  return r?.total ?? 0;
}

/** One-click removal: every product, stored image and embedding of a brand, and its permission file. */
export async function removeBrand(brandId: string) {
  const ids = (await sql<{ id: string }>('select id from reference_outfits where brand_id = $1', [brandId])).map((o) => o.id);
  await sql(`delete from label_pairs where (left_kind = 'reference' and left_id = any($1::uuid[])) or (right_kind = 'reference' and right_id = any($1::uuid[]))`, [ids]);
  await sql('delete from partner_brands where id = $1', [brandId]);   // cascades to outfits, photos, embeddings, attributes
  return ids.length;
}
