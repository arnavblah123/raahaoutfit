/** Loads either side of a comparison (guest outfit, reference product, or consented training crop). */
import { one, sql } from './db';
import { assertPublicUrl } from './feeds';
import { forModel, normalise } from './images';
import { loadVocab, summarise } from './vocab';
import type { JudgeSide } from './ai';

export type ItemKind = 'guest' | 'reference' | 'training';
export type ItemRef = { kind: ItemKind; id: string };

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
    return (await one<{ attributes: Record<string, string[]> }>('select attributes from training_outfits where id = $1', [ref.id]))?.attributes ?? {};
  }
  const rows = ref.kind === 'guest'
    ? await sql('select group_id, value_id, other_text from outfit_attributes where outfit_id = $1 and confirmed order by position', [ref.id])
    : await sql('select group_id, value_id, other_text from reference_attributes where reference_outfit_id = $1 order by position', [ref.id]);
  return summarise(await loadVocab(), rows);
}

export async function loadPhotos(ref: ItemRef, max = 4): Promise<{ key: string; jpeg: Buffer }[]> {
  let rows: { id: string; image: Buffer | null; source_url?: string | null }[];
  if (ref.kind === 'guest') {
    // Full view, close-up, then the newest extra photos: those were asked for because they settle the question.
    rows = await sql(`select id, image from outfit_photos where outfit_id = $1
                      order by array_position(array['full','closeup','extra'], kind), created_at desc limit $2`, [ref.id, max]);
  } else if (ref.kind === 'training') {
    rows = await sql('select id, image from training_photos where training_outfit_id = $1 limit $2', [ref.id, max]);
  } else {
    rows = await sql('select id, image, source_url from reference_photos where reference_outfit_id = $1 order by sort limit $2', [ref.id, Math.min(max, 2)]);
  }
  return Promise.all(rows.map(async (r) => ({ key: r.id, jpeg: await forModel(r.image ?? await fetchImage(r.source_url!)) })));
}

export async function loadSide(ref: ItemRef): Promise<JudgeSide & { key: string }> {
  const [photos, attributes] = await Promise.all([loadPhotos(ref), loadAttributes(ref)]);
  if (!photos.length) throw new Error(`No photos for ${ref.kind} ${ref.id}`);
  return { photos: photos.map((p) => p.jpeg), attributes, key: photos.map((p) => p.key).join(',') + JSON.stringify(attributes) };
}
