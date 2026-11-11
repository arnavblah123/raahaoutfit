import { db, must } from '@/lib/db';
import { ensureEmbeddings, ownOutfit } from '@/lib/outfits';
import { rerunAfterExtraPhoto } from '@/lib/pipeline/match';
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
  const pending = must(await db().from('outfit_photos').select('id').eq('outfit_id', id).is('embedding', null)) as any[];
  if (!pending.length) return Response.json({ error: 'Nothing new to check.' }, { status: 400 });
  try {
    await ensureEmbeddings(id, body?.embeddings);
  } catch {
    return Response.json({ error: 'We could not process that photo just now. Please try again in a minute.' }, { status: 503 });
  }
  await rerunAfterExtraPhoto(id);
  const result = must(await db().from('outfit_results').select('verdict,reason,state').eq('outfit_id', id).maybeSingle());
  return Response.json({ result });
}
