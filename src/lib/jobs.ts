/** Scheduled and admin-triggered jobs. Each is safe to run twice. */
import { db, must } from './db';
import { mergeVocabulary } from './ai';
import { fetchShopify, fetchWooCommerce, parseCsvFeed, type FeedProduct } from './feeds';
import { loadAttributes } from './items';
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
  const live = new Set(products.map((p) => p.external_id));
  const stored = must(await db().from('reference_outfits').select('id,external_id').eq('source', 'raaha')) as any[];
  const gone = stored.filter((r) => !live.has(r.external_id)).map((r) => r.id);
  if (gone.length) await db().from('reference_outfits').delete().in('id', gone);
  await setJobTotal(job.id);
  return { job, fresh, removed: gone.length, inFeed: products.length };
}

export class PermissionMissing extends Error {}

/** Partner brand import. Refuses to run unless written permission is on file. */
export async function brandImport(brandId: string, costCapUsd: number, csvText?: string) {
  const brand = must(await db().from('partner_brands').select('*').eq('id', brandId).maybeSingle()) as any;
  if (!brand) throw new Error('Brand not found');
  if (!brand.permission_date || !(brand.permission_note?.trim() || brand.permission_file_path)) {
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

/** Advance every running job a little. Called every few minutes by cron, and by the scripts. */
export async function workerTick(deadline: number) {
  const jobs = must(await db().from('batch_jobs').select('id').eq('status', 'running').order('created_at')) as any[];
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
  const today = new Date().toISOString().slice(0, 10);
  const weddings = must(await db().from('weddings').select('id').lte('purge_after', today).is('purged_at', null).limit(20)) as any[];
  let outfitsPurged = 0, kept = 0;
  for (const w of weddings) {
    const outfits = must(await db().from('outfits')
      .select('id,function_id,status,keep_for_training,colour_family_id, outfit_photos(kind,storage_path)').eq('wedding_id', w.id)) as any[];
    const { count: guests } = await db().from('guests').select('id', { count: 'exact', head: true }).eq('wedding_id', w.id);
    const byColour: Record<string, number> = {};
    for (const o of outfits) if (o.status === 'confirmed') {
      const k = `${o.function_id}:${o.colour_family_id}`; byColour[k] = (byColour[k] ?? 0) + 1;
    }
    for (const o of outfits) {
      const paths = o.outfit_photos.map((p: any) => p.storage_path);
      if (o.keep_for_training && o.status === 'confirmed') {
        must(await db().from('training_outfits').upsert({ id: o.id, attributes: await loadAttributes({ kind: 'guest', id: o.id }) }), 'keep consented outfit');
        for (const p of o.outfit_photos) {
          const { data } = await db().storage.from('outfits').download(p.storage_path);
          if (!data) continue;
          const path = `${o.id}/${p.storage_path.split('/').pop()}`;
          await db().storage.from('training').upload(path, Buffer.from(await data.arrayBuffer()), { contentType: 'image/jpeg', upsert: true });
          await db().from('training_photos').insert({ training_outfit_id: o.id, kind: p.kind, storage_path: path });
        }
        await db().from('label_pairs').update({ left_kind: 'training' }).eq('left_kind', 'guest').eq('left_id', o.id);
        await db().from('label_pairs').update({ right_kind: 'training' }).eq('right_kind', 'guest').eq('right_id', o.id);
        kept++;
      } else {
        await db().from('label_pairs').delete().eq('left_kind', 'guest').eq('left_id', o.id);
        await db().from('label_pairs').delete().eq('right_kind', 'guest').eq('right_id', o.id);
      }
      await db().from('result_feedback').update({ pair_snapshot: null }).eq('outfit_id', o.id);
      if (paths.length) await db().storage.from('outfits').remove(paths);
      outfitsPurged++;
    }
    must(await db().from('outfits').delete().eq('wedding_id', w.id), 'purge outfits');   // cascades: photos, vectors, attributes, pairs, results
    must(await db().from('guests').delete().eq('wedding_id', w.id), 'purge guests');
    await db().from('rate_limit_events').delete().eq('wedding_id', w.id);
    must(await db().from('weddings').update({
      purged_at: new Date().toISOString(),
      purged_stats: { guests: guests ?? 0, outfits: outfits.length, outfits_by_function_and_colour_family: byColour },
    }).eq('id', w.id), 'mark purged');
  }
  return { weddings: weddings.length, outfitsPurged, keptWithConsent: kept };
}

// ------------------------------------------------------------------ learning
/**
 * LLM pass over pending vocabulary: flags spellings and synonyms of existing values.
 * It only suggests; a merge takes effect when the admin accepts it.
 */
export async function vocabMergePass() {
  const vocab = await loadVocab(true);
  const pending = must(await db().from('attribute_pending').select('id,group_id,normalised_value').eq('status', 'pending').is('suggested_merge_id', null).limit(400)) as any[];
  let suggested = 0;
  for (const g of vocab.groups.filter((x) => !x.free_text)) {
    const mine = pending.filter((p) => p.group_id === g.id);
    if (!mine.length) continue;
    const { data, usage } = await mergeVocabulary(g.label, g.values.map((v) => v.value), mine.map((p) => p.normalised_value));
    await logUsage(usage, {});
    for (const m of data.merges) {
      const target = g.values.find((v) => norm(v.value) === norm(m.same_as));
      const row = mine.find((p) => p.normalised_value === norm(m.pending));
      if (target && row) { await db().from('attribute_pending').update({ suggested_merge_id: target.id }).eq('id', row.id); suggested++; }
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
  const rows = must(await db().from('label_pairs').select('similarity,admin_label').not('admin_label', 'is', null).not('similarity', 'is', null).limit(20000)) as any[];
  const clash = rows.filter((r) => r.admin_label !== 'different').map((r) => r.similarity as number).sort((a, b) => a - b);
  const old = s.judge_threshold;
  let next = old;
  const enough = clash.length >= 20;
  if (enough) {
    const idx = Math.floor((1 - s.threshold_target_recall) * clash.length);
    next = Math.round(Math.max(0.3, Math.min(0.9, clash[idx] - 0.01)) * 1000) / 1000;
  }
  const passed = rows.filter((r) => r.similarity >= next);
  const metric = {
    labelled: rows.length, clash_labels: clash.length, changed: enough && next !== old,
    note: enough ? undefined : 'Fewer than 20 clash labels: threshold left unchanged',
    recall_at_new: clash.length ? clash.filter((x) => x >= next).length / clash.length : null,
    share_sent_to_judge: rows.length ? passed.length / rows.length : null,
  };
  must(await db().from('threshold_log').insert({ old_value: old, new_value: next, sample_size: rows.length, metric }), 'log threshold');
  if (next !== old) await setSetting('judge_threshold', next);
  return { old, next, ...metric };
}
