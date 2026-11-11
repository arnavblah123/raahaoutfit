/** Shared server logic for guest photo uploads. Originals exist only in memory and are never stored. */
import { isUuid, one, sql } from './db';
import { embedImage, embeddingModelTag, normaliseVector, toPgVector } from './embed/server';
import { MAX_UPLOAD_BYTES, clampBbox, cropToBbox, normalise } from './images';
import type { Guest } from './session';

export async function readUpload(file: FormDataEntryValue | null) {
  if (!(file instanceof File)) throw new UploadError('A photo is missing.');
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('That photo is too large. Please try again.');
  try {
    return await normalise(Buffer.from(await file.arrayBuffer()));
  } catch {
    throw new UploadError('That file is not a photo we can read.');
  }
}
export class UploadError extends Error {}

/** Crop to the outfit box (face excluded), strip metadata, store only the crop. */
export async function storeCropped(opts: {
  outfitId: string; kind: 'full' | 'closeup' | 'extra';
  image: { jpeg: Buffer; width: number; height: number }; bbox: any;
}) {
  const box = clampBbox(opts.bbox);
  const cropped = await cropToBbox(opts.image.jpeg, opts.image.width, opts.image.height, box);
  const row = await one<{ id: string }>(
    `insert into outfit_photos (outfit_id, kind, image, width, height, bbox) values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [opts.outfitId, opts.kind, cropped.jpeg, cropped.width, cropped.height, JSON.stringify(box)]);
  return { id: row!.id, kind: opts.kind as string };
}

/** Photo links. The route behind them serves a photo only to the guest who owns it. */
export const photoUrls = (code: string, photos: { id: string; kind: string }[]) =>
  photos.map((p) => ({ id: p.id, kind: p.kind, url: `/api/w/${code}/photos/${p.id}` }));

/** Store vectors for every photo that lacks one: the browser's if valid, otherwise computed here. */
export async function ensureEmbeddings(outfitId: string, fromClient: Record<string, number[]> | undefined) {
  const photos = await sql<{ id: string }>('select id from outfit_photos where outfit_id = $1 and embedding is null', [outfitId]);
  for (const p of photos) {
    let v = fromClient?.[p.id] ? normaliseVector(fromClient[p.id]) : null;
    if (!v) {
      const row = await one<{ image: Buffer }>('select image from outfit_photos where id = $1', [p.id]);
      v = await embedImage(row!.image);
    }
    await sql('update outfit_photos set embedding = $1::vector, embedding_model = $2 where id = $3', [toPgVector(v), embeddingModelTag(), p.id]);
  }
}

export async function ownOutfit(guest: Guest, outfitId: string) {
  if (!isUuid(outfitId)) return null;
  return one<any>(`select id, wedding_id, function_id, guest_id, status, keep_for_training, extra_rounds_used, confirmed_at
                   from outfits where id = $1 and guest_id = $2`, [outfitId, guest.id]);
}
