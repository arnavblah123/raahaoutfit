/**
 * IndoFashion import (internal training and testing only; never shown to guests).
 *
 * DO NOT RUN before the dataset's terms have been approved. The dataset is not downloaded by
 * this script: request it from the authors (form linked from github.com/IndoFashion/IndoFashion),
 * unpack it locally, then point this script at it.
 *
 * Pilot (500 images, evenly across the women's garment classes, processed straight away):
 *   npm run import:indofashion -- --root data/indofashion --metadata data/indofashion/train_data.json --n 500 --cap 2
 * Batch of 10,000 (registered only; it waits for approval and a cost cap on the admin Imports page):
 *   npm run import:indofashion -- --root data/indofashion --metadata data/indofashion/train_data.json --n 10000 --register-only
 * then run `npm run worker` (or let the daily cron worker do it). Both are resumable.
 *
 * --metadata is the dataset's JSON-lines file with image_path and class_label per row.
 * Without --metadata, --root is read as one folder per class.
 */
import { args, bar, usd } from './_env';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { closeDb, one, sql } from '../src/lib/db';
import { forModel, normalise } from '../src/lib/images';
import { INDOFASHION_CLASSES, canonicalClass } from '../src/lib/indofashion';
import { addStoredPhoto, createJob, runJob, setJobTotal } from '../src/lib/reference';

const a = args();
if (!a.root) { console.error('Usage: --root <dataset dir> [--metadata <jsonl>] [--n 500] [--cap 2] [--register-only] [--seed 1]'); process.exit(1); }
const n = Number(a.n ?? 500);

// 1. Collect candidate images per class.
const byClass = new Map<string, { file: string; label: string }[]>();
const add = (file: string, label: string) => {
  const c = canonicalClass(label);
  if (!c || !(c in INDOFASHION_CLASSES)) return;
  (byClass.get(c) ?? byClass.set(c, []).get(c)!).push({ file, label });
};
if (a.metadata) {
  for (const line of readFileSync(a.metadata, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.image_path && row.class_label) add(path.resolve(a.root, row.image_path), String(row.class_label));
  }
} else {
  for (const dir of readdirSync(a.root)) {
    const full = path.join(a.root, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full)) if (/\.(jpe?g|png|webp)$/i.test(f)) add(path.join(full, f), dir);
  }
}
const classes = [...byClass.keys()].sort();
if (!classes.length) { console.error('No women\'s garment classes found. Check --root / --metadata.'); process.exit(1); }

// 2. Sample evenly across classes, deterministically (same seed -> same sample, so re-runs resume).
const seed = a.seed ?? '1';
const rank = (s: string) => createHash('sha1').update(seed + s).digest('hex');
const per = Math.ceil(n / classes.length);
const picked = classes.flatMap((c) => byClass.get(c)!.sort((x, y) => (rank(x.file) < rank(y.file) ? -1 : 1)).slice(0, per)).slice(0, n);
console.log(`Classes: ${classes.map((c) => `${c} (${byClass.get(c)!.length})`).join(', ')}`);
console.log(`Sampling ${picked.length} images, about ${per} per class. Men's classes and accessories are skipped.`);

// 3. Register rows and store a reduced copy of each image in the database (internal use only).
const registerOnly = a['register-only'] === 'true';
const job = await createJob('indofashion', Number(a.cap ?? 2), { n: picked.length, seed, pilot: !registerOnly }, registerOnly ? 'pending' : 'running');
let added = 0;
for (const [i, p] of picked.entries()) {
  bar(i + 1, picked.length, 'storing');
  const externalId = path.relative(a.root, p.file);
  if (!existsSync(p.file) || await one(`select 1 from reference_outfits where source = 'indofashion' and external_id = $1`, [externalId])) continue;
  const jpeg = await forModel((await normalise(readFileSync(p.file))).jpeg, 768);
  const row = (await one<{ id: string }>(
    `insert into reference_outfits (source, external_id, dataset_label, category, status, batch_job_id) values ('indofashion', $1, $2, $2, 'pending', $3) returning id`,
    [externalId, p.label, job.id]))!;
  await addStoredPhoto(row.id, jpeg, 0);
  added++;
}
await setJobTotal(job.id);
console.log(`\nRegistered ${added} new images under job ${job.id}.`);

if (registerOnly) {
  console.log('The batch is waiting for approval. Open /admin/imports to see the cost estimate, set a cap and start it.');
} else {
  const done: any = await runJob(job.id, Date.now() + 12 * 3600_000, (j) => bar(j.done + j.failed, j.total, `spent ${usd(j.cost_spent_usd)} of ${usd(j.cost_cap_usd)}`));
  console.log(`\n${done.status}: ${done.done} processed, ${done.failed} failed, spent ${usd(done.cost_spent_usd)}.`);
  console.table(await sql('select * from label_mismatch_summary()'));
  if (done.done) console.log(`Estimated AI cost for 10,000 images: ${usd((done.cost_spent_usd / done.done) * 10000)}`);
  console.log('Review the mismatches at /admin/reference?source=indofashion&show=mismatch');
}
await closeDb();
