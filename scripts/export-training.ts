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
import { db, must } from '../src/lib/db';
import { loadAttributes, type ItemKind } from '../src/lib/items';

const out = path.join(args().out ?? 'exports', new Date().toISOString().slice(0, 10));
mkdirSync(path.join(out, 'images'), { recursive: true });
const outfits = new Map<string, any>();

async function save(bucket: string, storagePath: string, name: string) {
  const { data } = await db().storage.from(bucket).download(storagePath);
  if (!data) return null;
  writeFileSync(path.join(out, 'images', name), Buffer.from(await data.arrayBuffer()));
  return `images/${name}`;
}
async function addItem(kind: ItemKind, id: string) {
  const key = `${kind}:${id}`;
  if (outfits.has(key) || kind === 'guest') return outfits.has(key);   // live guest outfits are never exported
  const images: string[] = [];
  if (kind === 'training') {
    for (const p of must(await db().from('training_photos').select('id,kind,storage_path').eq('training_outfit_id', id)) as any[]) {
      const f = await save('training', p.storage_path, `training-${id}-${p.kind}-${p.id}.jpg`); if (f) images.push(f);
    }
  } else {
    for (const p of must(await db().from('reference_photos').select('id,storage_path,source_url,sort').eq('reference_outfit_id', id).order('sort')) as any[]) {
      if (p.storage_path) { const f = await save('reference', p.storage_path, `reference-${id}-${p.sort}.jpg`); if (f) images.push(f); }
      else if (p.source_url) images.push(p.source_url);
    }
  }
  if (!images.length) return false;
  outfits.set(key, { id: key, kind, attributes: await loadAttributes({ kind, id }), images });
  return true;
}

const training = must(await db().from('training_outfits').select('id')) as any[];
for (const [i, t] of training.entries()) { bar(i + 1, training.length, 'consented photos'); await addItem('training', t.id); }
const labels = must(await db().from('label_pairs').select('*').not('admin_label', 'is', null).limit(50000)) as any[];
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
