/**
 * Retrieval evaluation for the shortlist step.
 *   npm run eval -- --dir eval-sets [--k 5]
 * Layout: one folder per outfit, each holding two or more photos of that same outfit:
 *   eval-sets/red-lehenga-01/a.jpg, b.jpg, c.jpg
 *   eval-sets/green-saree-02/1.jpg, 2.jpg
 * Each photo is used as a query against every other photo. A hit means a photo of the same
 * outfit is among the top k by cosine similarity. Needs no database and no AI key.
 */
import { args, bar } from './_env';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { embedImage } from '../src/lib/embed/server';
import { normalise } from '../src/lib/images';
import { topKReport } from '../src/lib/evalmath';

const a = args();
if (!a.dir) { console.error('Usage: npm run eval -- --dir <folder of same-outfit photo sets> [--k 5]'); process.exit(1); }
const k = Number(a.k ?? 5);
const items: { set: string; file: string; v: number[] }[] = [];
const files = readdirSync(a.dir).filter((d) => statSync(path.join(a.dir, d)).isDirectory())
  .flatMap((set) => readdirSync(path.join(a.dir, set)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => ({ set, file: path.join(a.dir, set, f) })));
for (const [i, f] of files.entries()) {
  bar(i + 1, files.length, 'embedding');
  items.push({ ...f, v: await embedImage((await normalise(readFileSync(f.file))).jpeg) });
}
const r = topKReport(items, k);
console.log(`\n\nSets: ${r.sets}   Query photos: ${r.queries}`);
console.log(`True match in top 1: ${(r.hitAt1 * 100).toFixed(1)}%`);
console.log(`True match in top ${k}: ${(r.hitAtK * 100).toFixed(1)}%`);
console.log(`Mean similarity, same outfit: ${r.meanSame.toFixed(3)}   different outfits: ${r.meanDifferent.toFixed(3)}`);
console.log(`Lowest same-outfit similarity: ${r.minSame.toFixed(3)} (the shortlist threshold should sit below this)`);
if (r.misses.length) { console.log(`\nMisses (no same-outfit photo in the top ${k}):`); for (const m of r.misses) console.log(`  ${m.file}  -> nearest: ${m.nearest}`); }
