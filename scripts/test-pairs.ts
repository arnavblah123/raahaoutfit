/**
 * Run sample pairs through the whole pipeline and print verdicts and cost.
 *   npm run test:pairs -- --dir samples/pairs
 * Layout: one folder per pair. Photos starting with "a" are outfit A, with "b" outfit B.
 *   samples/pairs/same-lehenga/a1.jpg a2.jpg b1.jpg b2.jpg
 *   samples/pairs/same-lehenga/expected.txt      (optional: same_outfit | same_design_diff_colour | similar_look | no_clash)
 * Needs ANTHROPIC_API_KEY. Uses the seed vocabulary file, so no database is required.
 * Add --no-embed to skip the similarity column (and the model download).
 */
import { args, usd } from './_env';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { judgePair, type Usage } from '../src/lib/ai';
import { embedImage } from '../src/lib/embed/server';
import { dot } from '../src/lib/evalmath';
import { forModel, normalise } from '../src/lib/images';
import { runRead } from '../src/lib/pipeline/read';
import type { Vocab } from '../src/lib/vocab';

const a = args();
if (!a.dir) { console.error('Usage: npm run test:pairs -- --dir <folder of pairs> [--no-embed]'); process.exit(1); }
const vocab = JSON.parse(readFileSync('supabase/seed-vocab.json', 'utf8')) as Vocab;
const usage: Usage[] = [];
let correct = 0, withExpected = 0;

async function side(dir: string, prefix: string) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().startsWith(prefix) && /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (!files.length) throw new Error(`No photos starting with "${prefix}" in ${dir}`);
  const jpegs = await Promise.all(files.slice(0, 4).map(async (f) => (await normalise(readFileSync(path.join(dir, f)))).jpeg));
  const read = await runRead(jpegs.slice(0, 2), undefined, vocab);
  usage.push(read.usage);
  // In the app the guest confirms these; here the AI's reading stands in for her.
  const attributes: Record<string, string[]> = {};
  for (const s of read.suggestions) {
    const g = vocab.groups.find((x) => x.id === s.group_id)!;
    const vals = [...s.value_ids.map((id) => g.values.find((v) => v.id === id)!.value), ...(s.other ? [s.other] : [])];
    if (vals.length) attributes[g.label] = vals;
  }
  return { jpegs, attributes, notOutfit: read.notOutfit };
}

for (const name of readdirSync(a.dir).filter((d) => statSync(path.join(a.dir, d)).isDirectory()).sort()) {
  const dir = path.join(a.dir, name);
  try {
    const [A, B] = [await side(dir, 'a'), await side(dir, 'b')];
    let sim = NaN;
    if (a['no-embed'] !== 'true') sim = dot(await embedImage(A.jpegs[0]), await embedImage(B.jpegs[0]));
    const { data, usage: u } = await judgePair(
      { photos: await Promise.all(A.jpegs.map((j) => forModel(j))), attributes: A.attributes },
      { photos: await Promise.all(B.jpegs.map((j) => forModel(j))), attributes: B.attributes });
    usage.push(u);
    const expectedFile = path.join(dir, 'expected.txt');
    const expected = existsSync(expectedFile) ? readFileSync(expectedFile, 'utf8').trim() : '';
    if (expected) { withExpected++; if (expected === data.verdict) correct++; }
    console.log(`\n${name}${A.notOutfit || B.notOutfit ? '  [flagged: not an outfit]' : ''}`);
    console.log(`  similarity ${Number.isNaN(sim) ? 'skipped' : sim.toFixed(3)}   verdict ${data.verdict} (${data.confidence})${expected ? `   expected ${expected} ${expected === data.verdict ? 'OK' : 'MISMATCH'}` : ''}`);
    console.log(`  reason: ${data.reason}`);
    if (data.missing_evidence) console.log(`  missing evidence: ${data.missing_evidence} (limiting side: ${data.limiting_side})`);
  } catch (e: any) {
    if (e?.usage) usage.push(e.usage);
    console.log(`\n${name}\n  FAILED: ${e?.message ?? e}`);
  }
}

const sum = (step: string) => usage.filter((u) => u.step === step).reduce((s, u) => ({ i: s.i + u.input_tokens, o: s.o + u.output_tokens, c: s.c + u.cost_usd, n: s.n + 1 }), { i: 0, o: 0, c: 0, n: 0 });
const r = sum('read'), j = sum('judge');
console.log('\n--- Cost ---');
console.log(`Read:  ${r.n} calls, ${r.i} input + ${r.o} output tokens, ${usd(r.c)}`);
console.log(`Judge: ${j.n} calls, ${j.i} input + ${j.o} output tokens, ${usd(j.c)}`);
console.log(`Total: ${usd(r.c + j.c)}${j.n ? `   per pair: ${usd((r.c + j.c) / j.n)}` : ''}`);
if (withExpected) console.log(`Verdicts matching expected.txt: ${correct} of ${withExpected}`);
