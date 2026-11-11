import { requireAdmin } from '@/lib/admin';
import { isUuid, one } from '@/lib/db';

/** Stored photos for the admin pages. Guest photos are served only where the guest gave consent. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const a = await requireAdmin();
  if (a.error) return a.error;
  const { kind, id } = await params;
  if (!isUuid(id)) return new Response('Not found', { status: 404 });
  const row = kind === 'reference' ? await one<{ image: Buffer | null }>('select image from reference_photos where id = $1', [id])
    : kind === 'training' ? await one<{ image: Buffer }>('select image from training_photos where id = $1', [id])
    : kind === 'guest' ? await one<{ image: Buffer }>(
      'select p.image from outfit_photos p join outfits o on o.id = p.outfit_id where p.id = $1 and o.keep_for_training', [id])
    : null;
  if (!row?.image) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.image), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600' } });
}
