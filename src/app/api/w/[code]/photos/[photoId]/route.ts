import { asGuest, isUuid } from '@/lib/db';
import { requireGuest } from '@/lib/session';

/**
 * Serves one of the guest's own cropped photos. The query runs as the restricted database role,
 * so row-level security returns nothing for a photo that belongs to anyone else.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string; photoId: string }> }) {
  const { code, photoId } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  if (!isUuid(photoId)) return new Response('Not found', { status: 404 });
  const rows = await asGuest(r.guest, (q) => q<{ image: Buffer }>('select image from outfit_photos where id = $1', [photoId]));
  if (!rows.length) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(rows[0].image), {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600', 'x-robots-tag': 'noindex' },
  });
}
