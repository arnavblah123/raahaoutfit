import { ownOutfit } from '@/lib/outfits';
import { deleteOutfit } from '@/lib/pipeline/match';
import { requireGuest } from '@/lib/session';

/** A guest can delete an outfit at any time: image, embeddings and attributes all go. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  if (!(await ownOutfit(r.guest, id))) return Response.json({ error: 'Not found' }, { status: 404 });
  await deleteOutfit(id);
  return Response.json({ ok: true });
}
