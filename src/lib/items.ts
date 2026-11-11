/** Loads either side of a comparison (guest outfit, reference product, or consented training crop). */
import { db, must } from './db';
import { assertPublicUrl } from './feeds';
import { forModel, normalise } from './images';
import { loadVocab, summarise } from './vocab';
import type { JudgeSide } from './ai';

export type ItemKind = 'guest' | 'reference' | 'training';
export type ItemRef = { kind: ItemKind; id: string };

async function download(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Could not load photo ${bucket}/${path}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Fetch a public product image. Size-capped and re-encoded before anything else touches it. */
export async function fetchImage(url: string): Promise<Buffer> {
  assertPublicUrl(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'outfit-clash-importer' } });
  if (!res.ok) throw new Error(`Image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15_000_000) throw new Error('Image too large');
  return (await normalise(buf)).jpeg;
}

export async function loadAttributes(ref: ItemRef): Promise<Record<string, string[]>> {
  if (ref.kind === 'training') {
    const row = must(await db().from('training_outfits').select('attributes').eq('id', ref.id).maybeSingle());
    return (row as any)?.attributes ?? {};
  }
  const vocab = await loadVocab();
  const q = ref.kind === 'guest'
    ? db().from('outfit_attributes').select('group_id,value_id,other_text').eq('outfit_id', ref.id).eq('confirmed', true).order('position')
    : db().from('reference_attributes').select('group_id,value_id,other_text').eq('reference_outfit_id', ref.id).order('position');
  return summarise(vocab, must(await q) as any[]);
}

export async function loadPhotos(ref: ItemRef, max = 4): Promise<{ key: string; jpeg: Buffer }[]> {
  if (ref.kind === 'guest') {
    const rows = must(await db().from('outfit_photos').select('id,kind,storage_path,created_at').eq('outfit_id', ref.id)) as any[];
    const order = { full: 0, closeup: 1, extra: 2 } as Record<string, number>;
    // Newest extra photos first: they were asked for because they settle the question.
    rows.sort((a, b) => order[a.kind] - order[b.kind] || (a.created_at < b.created_at ? 1 : -1));
    return Promise.all(rows.slice(0, max).map(async (r) => ({ key: r.id, jpeg: await forModel(await download('outfits', r.storage_path)) })));
  }
  if (ref.kind === 'training') {
    const rows = must(await db().from('training_photos').select('id,storage_path').eq('training_outfit_id', ref.id)) as any[];
    return Promise.all(rows.slice(0, max).map(async (r) => ({ key: r.id, jpeg: await forModel(await download('training', r.storage_path)) })));
  }
  const rows = must(await db().from('reference_photos').select('id,storage_path,source_url').eq('reference_outfit_id', ref.id).order('sort')) as any[];
  return Promise.all(rows.slice(0, Math.min(max, 2)).map(async (r) => ({
    key: r.id,
    jpeg: await forModel(r.storage_path ? await download('reference', r.storage_path) : await fetchImage(r.source_url)),
  })));
}

export async function loadSide(ref: ItemRef): Promise<JudgeSide & { key: string }> {
  const [photos, attributes] = await Promise.all([loadPhotos(ref), loadAttributes(ref)]);
  if (!photos.length) throw new Error(`No photos for ${ref.kind} ${ref.id}`);
  return { photos: photos.map((p) => p.jpeg), attributes, key: photos.map((p) => p.key).join(',') + JSON.stringify(attributes) };
}
