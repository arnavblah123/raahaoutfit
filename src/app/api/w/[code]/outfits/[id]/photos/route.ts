import { db } from '@/lib/db';
import { AiError } from '@/lib/ai';
import { UploadError, ownOutfit, readUpload, signPhotos, storeCropped } from '@/lib/outfits';
import { runRead } from '@/lib/pipeline/read';
import { checkRate } from '@/lib/ratelimit';
import { requireGuest } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { logUsage } from '@/lib/usage';

export const maxDuration = 120;
const MAX_EXTRA = 4;

/** An extra photo, asked for when the judge could not decide. Cropped and stripped like the others. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  const outfit = await ownOutfit(r.guest, id);
  if (!outfit || outfit.status !== 'confirmed') return Response.json({ error: 'Not found' }, { status: 404 });
  const { count } = await db().from('outfit_photos').select('id', { count: 'exact', head: true }).eq('outfit_id', id).eq('kind', 'extra');
  if ((count ?? 0) >= MAX_EXTRA) return Response.json({ error: 'This outfit already has the maximum number of photos.' }, { status: 409 });

  const form = await req.formData().catch(() => null);
  let image;
  try {
    image = await readUpload(form?.get('photo') ?? null);
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const s = await getSettings();
  const limited = await checkRate('upload', r.guest.id, r.wedding.id, s.uploads_per_guest_per_day, s.uploads_per_wedding_per_day);
  if (limited) return Response.json({ error: limited }, { status: 429 });

  let read;
  try {
    read = await runRead([image.jpeg]);
    await logUsage(read.usage, { outfit_id: id });
  } catch (e: any) {
    await logUsage(e?.usage, { outfit_id: id });
    if (e instanceof AiError) return Response.json({ error: 'We could not read that photo just now. Please try again.' }, { status: 503 });
    throw e;
  }
  if (read.notOutfit) return Response.json({ error: 'That does not look like an outfit photo.' }, { status: 422 });
  const photo = await storeCropped({ guest: r.guest, outfitId: id, kind: 'extra', image, bbox: read.photos[0]?.bbox });
  return Response.json({ photos: await signPhotos(r.guest, [photo]) });
}
