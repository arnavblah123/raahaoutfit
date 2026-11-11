/** Shared server logic for guest photo uploads. Originals exist only in memory and are never stored. */
import { randomUUID } from 'crypto';
import { db, guestDb, must } from './db';
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
  guest: Guest; outfitId: string; kind: 'full' | 'closeup' | 'extra';
  image: { jpeg: Buffer; width: number; height: number }; bbox: any;
}) {
  const box = clampBbox(opts.bbox);
  const cropped = await cropToBbox(opts.image.jpeg, opts.image.width, opts.image.height, box);
  const id = randomUUID();
  const path = `${opts.guest.wedding_id}/${opts.guest.id}/${opts.outfitId}/${id}.jpg`;
  const up = await db().storage.from('outfits').upload(path, cropped.jpeg, { contentType: 'image/jpeg' });
  if (up.error) throw new Error(`Could not store photo: ${up.error.message}`);
  must(await db().from('outfit_photos').insert({
    id, outfit_id: opts.outfitId, kind: opts.kind, storage_path: path,
    width: cropped.width, height: cropped.height, bbox: box,
  }), 'save photo');
  return { id, kind: opts.kind, path };
}

/** Short-lived links, created with the guest's own scoped client so RLS decides what she can load. */
export async function signPhotos(guest: Guest, photos: { id: string; kind: string; path: string }[], seconds = 600) {
  if (!photos.length) return [];
  const { data, error } = await guestDb(guest).storage.from('outfits').createSignedUrls(photos.map((p) => p.path), seconds);
  if (error) throw new Error(`Could not sign photo links: ${error.message}`);
  return photos.map((p, i) => ({ id: p.id, kind: p.kind, url: data?.[i]?.signedUrl ?? '' }));
}

/** Store vectors for every photo that lacks one: the browser's if valid, otherwise computed here. */
export async function ensureEmbeddings(outfitId: string, fromClient: Record<string, number[]> | undefined) {
  const photos = must(await db().from('outfit_photos').select('id,storage_path').eq('outfit_id', outfitId).is('embedding', null)) as any[];
  for (const p of photos) {
    let v = fromClient?.[p.id] ? normaliseVector(fromClient[p.id]) : null;
    if (!v) {
      const { data, error } = await db().storage.from('outfits').download(p.storage_path);
      if (error || !data) throw new Error('Could not load photo for embedding');
      v = await embedImage(Buffer.from(await data.arrayBuffer()));
    }
    must(await db().from('outfit_photos').update({ embedding: toPgVector(v), embedding_model: embeddingModelTag() }).eq('id', p.id), 'save embedding');
  }
}

export async function ownOutfit(guest: Guest, outfitId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(outfitId)) return null;
  const { data } = await db().from('outfits').select('*').eq('id', outfitId).eq('guest_id', guest.id).maybeSingle();
  return data as any | null;
}
