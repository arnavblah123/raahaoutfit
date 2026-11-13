import { one } from '@/lib/db';
import { ensureEmbeddings, ownOutfit } from '@/lib/outfits';
import { rerunAfterExtraPhoto, runMatch } from '@/lib/pipeline/match';
import { requireGuest } from '@/lib/session';

export const maxDuration = 300;

/** After an extra photo: store its vector and re-judge the pairs that were waiting on it. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  const outfit = await ownOutfit(r.guest, id);
  if (!outfit || outfit.status !== 'confirmed') return Response.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const requested = !!(await one(`select 1 from photo_requests where outfit_id = $1 and status = 'open' limit 1`, [id]));
  if (!(await one('select 1 from outfit_photos where outfit_id = $1 and embedding is null limit 1', [id]))) return Response.json({ error: 'Nothing new to check.' }, { status: 400 });
  try {
    await ensureEmbeddings(id, body?.embeddings);
  } catch {
    return Response.json({ error: 'We could not process that photo just now. Please try again in a minute.' }, { status: 503 });
  }
  // A requested photo counts as one of the extra rounds. A photo the guest added on her own
  // simply re-checks her outfit against the others with the new photo included.
  if (requested) await rerunAfterExtraPhoto(id); else await runMatch(id);
  const result = await one('select verdict, reason, state from outfit_results where outfit_id = $1', [id]);
  return Response.json({ result });
}
