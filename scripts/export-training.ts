/**
 * Package confirmed data for future fine-tuning of the embedding model.
 *   npm run export:training -- --out exports
 * Writes: images/ (consented guest crops, plus stored reference photos used by a label),
 * outfits.jsonl (id, source, attributes, image files) and pairs.jsonl (two ids + the admin's label).
 * Only guest photos kept with consent and pairs confirmed by an admin are included. The model's own
 * unverified verdicts are never exported as labels.
 */
import { args, bar } from './_env';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { closeDb, sql } from '../src/lib/db';
import { loadAttributes, type ItemKind } from '../src/lib/items';

const out = path.join(args().out ?? 'exports', new Date().toISOString().slice(0, 10));
mkdirSync(path.join(out, 'images'), { recursive: true });
const outfits = new Map<string, any>();

function save(image: Buffer, name: string) {
  writeFileSync(path.join(out, 'images', name), image);
  return `images/${name}`;
}
async function addItem(kind: ItemKind, id: string) {
  const key = `${kind}:${id}`;
  if (outfits.has(key) || kind === 'guest') return outfits.has(key);   // live guest outfits are never exported
  const images: string[] = [];
  if (kind === 'training') {
    for (const p of await sql('select id, kind, image from training_photos where training_outfit_id = $1', [id])) images.push(save(p.image, `training-${id}-${p.kind}-${p.id}.jpg`));
  } else {
    for (const p of await sql('select image, source_url, sort from reference_photos where reference_outfit_id = $1 order by sort', [id])) {
      if (p.image) images.push(save(p.image, `reference-${id}-${p.sort}.jpg`)); else if (p.source_url) images.push(p.source_url);
    }
  }
  if (!images.length) return false;
  outfits.set(key, { id: key, kind, attributes: await loadAttributes({ kind, id }), images });
  return true;
}

const training = await sql('select id from training_outfits');
for (const [i, t] of training.entries()) { bar(i + 1, training.length, 'consented photos'); await addItem('training', t.id); }
const labels = await sql('select * from label_pairs where admin_label is not null');
const pairs: any[] = [];
for (const [i, l] of labels.entries()) {
  bar(i + 1, labels.length, 'confirmed pairs   ');
  if (await addItem(l.left_kind, l.left_id) && await addItem(l.right_kind, l.right_id)) {
    pairs.push({ a: `${l.left_kind}:${l.left_id}`, b: `${l.right_kind}:${l.right_id}`, label: l.admin_label, similarity: l.similarity });
  }
}
writeFileSync(path.join(out, 'outfits.jsonl'), [...outfits.values()].map((o) => JSON.stringify(o)).join('\n') + '\n');
writeFileSync(path.join(out, 'pairs.jsonl'), pairs.map((p) => JSON.stringify(p)).join('\n') + '\n');
console.log(`\nWrote ${outfits.size} outfits and ${pairs.length} labelled pairs to ${out}`);
await closeDb();
