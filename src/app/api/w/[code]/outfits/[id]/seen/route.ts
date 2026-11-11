import { sql } from '@/lib/db';
import { ownOutfit } from '@/lib/outfits';
import { requireGuest } from '@/lib/session';

/** The guest has looked at her result. Called from the result page itself, never from a prefetch. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  if (!(await ownOutfit(r.guest, id))) return Response.json({ error: 'Not found' }, { status: 404 });
  await sql('update outfit_results set seen_at = now() where outfit_id = $1 and seen_at is null', [id]);
  return Response.json({ ok: true });
}
