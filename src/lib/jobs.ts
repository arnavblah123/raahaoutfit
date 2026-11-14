/** Scheduled and admin-triggered jobs. Each is safe to run twice. */
import { json, one, sql, transaction } from './db';
import { mergeVocabulary } from './ai';
import { fetchShopify, fetchWooCommerce, parseCsvFeed, type FeedProduct } from './feeds';
import { loadAttributes } from './items';
import { deleteOutfit } from './pipeline/match';
import { createJob, runJob, setJobTotal, upsertProducts } from './reference';
import { getSettings, setSetting } from './settings';
import { logUsage } from './usage';
import { loadVocab, norm } from './vocab';

// ------------------------------------------------------------------ imports
/** Pull the Raaha catalogue; new products are queued under a cost-capped job. */
export async function raahaImport(costCapUsd?: number) {
  const s = await getSettings(true);
  const products = await fetchWooCommerce(s.raaha_feed_url);
  if (!products.length) throw new Error('The Raaha feed returned no products');
  const job = await createJob('raaha', costCapUsd ?? s.raaha_nightly_cost_cap_usd, { feed: s.raaha_feed_url, products: products.length });
  const fresh = await upsertProducts('raaha', null, products, job.id);
  // Products that have left the shop should not be suggested to guests any more.
  const gone = await sql(`delete from reference_outfits where source = 'raaha' and not (external_id = any($1::text[])) returning id`, [products.map((p) => p.external_id)]);
  await setJobTotal(job.id);
  return { job, fresh, removed: gone.length, inFeed: products.length };
}

export class PermissionMissing extends Error {}

/** Partner brand import. Refuses to run unless written permission is on file. */
export async function brandImport(brandId: string, costCapUsd: number, csvText?: string) {
  const brand = await one(
    `select id, name, feed_type, feed_url, permission_date, permission_note, permission_file is not null as has_file from partner_brands where id = $1`, [brandId]);
  if (!brand) throw new Error('Brand not found');
  if (!brand.permission_date || !(brand.permission_note?.trim() || brand.has_file)) {
    throw new PermissionMissing(`No permission on file for ${brand.name}. Add the date and a note or the brand's email before importing.`);
  }
  let products: FeedProduct[];
  if (brand.feed_type === 'csv') {
    if (!csvText) throw new Error('Upload the CSV file to import');
    products = parseCsvFeed(csvText);
  } else {
    if (!brand.feed_url) throw new Error('This brand has no feed URL');
    products = brand.feed_type === 'shopify' ? await fetchShopify(brand.feed_url) : await fetchWooCommerce(brand.feed_url);
  }
  if (!products.length) throw new Error('The feed has no products with images');
  const job = await createJob('partner', costCapUsd, { brand_id: brandId, brand: brand.name, products: products.length });
  const fresh = await upsertProducts('partner', brandId, products, job.id);
  await setJobTotal(job.id);
  return { job, fresh, inFeed: products.length };
}

/** Advance every running job a little. Called by cron and by scripts/worker.ts. */
export async function workerTick(deadline: number) {
  const jobs = await sql<{ id: string }>(`select id from batch_jobs where status = 'running' order by created_at`);
  const out = [];
  for (const j of jobs) { if (Date.now() > deadline) break; out.push(await runJob(j.id, deadline)); }
  return out;
}

// ------------------------------------------------------------------ retention
/**
 * Seven days after the wedding: delete photos, embeddings, attributes and guest names.
 * A consented outfit keeps only its cropped photos and attributes, with no link to guest or wedding.
 */
export async function purgeExpired() {
  const weddings = await sql<{ id: string }>('select id from weddings where purge_after <= current_date and purged_at is null limit 20');
  let outfitsPurged = 0, kept = 0;
  for (const w of weddings) {
    const outfits = await sql('select id, status, keep_for_training from outfits where wedding_id = $1', [w.id]);
    const consented = outfits.filter((o) => o.keep_for_training && o.status === 'confirmed');
    const snapshots = new Map<string, unknown>();
    for (const o of consented) snapshots.set(o.id, await loadAttributes({ kind: 'guest', id: o.id }));
    await transaction(async (q) => {
      const stats = await q(
        `select (select count(*) from guests where wedding_id = $1) as guests,
                (select count(*) from outfits where wedding_id = $1) as outfits,
                coalesce((select jsonb_agg(jsonb_build_object('function', c.function_id, 'colour_family', c.family_key, 'outfits', c.outfits))
                          from colour_map($1) c), '[]'::jsonb) as by_colour`, [w.id]);
      for (const o of consented) {
        await q('insert into training_outfits (id, attributes) values ($1, $2::jsonb) on conflict (id) do nothing', [o.id, json(snapshots.get(o.id))]);
        await q('insert into training_photos (training_outfit_id, kind, image) select outfit_id, kind, image from outfit_photos where outfit_id = $1', [o.id]);
        await q(`update label_pairs set left_kind = 'training' where left_kind = 'guest' and left_id = $1`, [o.id]);
        await q(`update label_pairs set right_kind = 'training' where right_kind = 'guest' and right_id = $1`, [o.id]);
      }
      const ids = outfits.map((o) => o.id);
      await q(`delete from label_pairs where (left_kind = 'guest' and left_id = any($1::uuid[])) or (right_kind = 'guest' and right_id = any($1::uuid[]))`, [ids]);
      await q('update result_feedback set pair_snapshot = null where outfit_id = any($1::uuid[])', [ids]);
      await q('delete from outfits where wedding_id = $1', [w.id]);      // cascades: photos, vectors, attributes, pairs, results
      await q('delete from guests where wedding_id = $1', [w.id]);
      await q('delete from guest_list where wedding_id = $1', [w.id]);
      await q('delete from rate_limit_events where wedding_id = $1', [w.id]);
      await q('update weddings set purged_at = now(), purged_stats = $2::jsonb where id = $1', [w.id, json(stats[0])]);
    });
    outfitsPurged += outfits.length; kept += consented.length;
  }
  await sql(`delete from otp_codes where created_at < now() - interval '2 days'`);
  // Uploads that were never confirmed are not kept around either.
  const stale = await sql<{ id: string }>(`select id from outfits where status = 'read' and created_at < now() - interval '48 hours' limit 200`);
  for (const o of stale) await deleteOutfit(o.id);
  await sql(`delete from rate_limit_events where created_at < now() - interval '7 days'`);
  return { weddings: weddings.length, outfitsPurged, keptWithConsent: kept, abandonedUploadsRemoved: stale.length };
}

// ------------------------------------------------------------------ learning
/**
 * LLM pass over pending vocabulary: flags spellings and synonyms of existing values.
 * It only suggests; a merge takes effect when the admin accepts it.
 */
export async function vocabMergePass() {
  const vocab = await loadVocab(true);
  const pending = await sql(`select id, group_id, normalised_value from attribute_pending where status = 'pending' and suggested_merge_id is null limit 400`);
  let suggested = 0;
  for (const g of vocab.groups.filter((x) => !x.free_text)) {
    const mine = pending.filter((p) => p.group_id === g.id);
    if (!mine.length) continue;
    const { data, usage } = await mergeVocabulary(g.label, g.values.map((v) => v.value), mine.map((p) => p.normalised_value));
    await logUsage(usage, {});
    for (const m of data.merges) {
      const target = g.values.find((v) => norm(v.value) === norm(m.same_as));
      const row = mine.find((p) => p.normalised_value === norm(m.pending));
      if (target && row) { await sql('update attribute_pending set suggested_merge_id = $1 where id = $2', [target.id, row.id]); suggested++; }
    }
  }
  return { reviewed: pending.length, suggested };
}

/**
 * Weekly: move the shortlist threshold to the highest similarity that still lets through the
 * target share of pairs a human labelled as a clash. Uses admin labels only. Logs every run.
 */
export async function recalcThreshold() {
  const s = await getSettings(true);
  const rows = await sql<{ similarity: number; admin_label: string }>(
    'select similarity, admin_label from label_pairs where admin_label is not null and similarity is not null');
  const clash = rows.filter((r) => r.admin_label !== 'different').map((r) => r.similarity).sort((a, b) => a - b);
  const old = s.judge_threshold;
  let next = old;
  const enough = clash.length >= 20;
  if (enough) {
    const idx = Math.floor((1 - s.threshold_target_recall) * clash.length);
    next = Math.round(Math.max(0.3, Math.min(0.9, clash[idx] - 0.01)) * 1000) / 1000;
  }
  const metric = {
    labelled: rows.length, clash_labels: clash.length, changed: enough && next !== old,
    note: enough ? undefined : 'Fewer than 20 clash labels: threshold left unchanged',
    recall_at_new: clash.length ? clash.filter((x) => x >= next).length / clash.length : null,
    share_sent_to_judge: rows.length ? rows.filter((r) => r.similarity >= next).length / rows.length : null,
  };
  await sql('insert into threshold_log (old_value, new_value, sample_size, metric) values ($1, $2, $3, $4::jsonb)', [old, next, rows.length, json(metric)]);
  if (next !== old) await setSetting('judge_threshold', next);
  return { old, next, ...metric };
}
