import { db, must } from '@/lib/db';
import { getGuest, getWedding, hashToken, newToken, setGuestCookie } from '@/lib/session';
import { clean } from '@/lib/weddings';

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) return Response.json({ error: 'This wedding link is not active.' }, { status: 404 });
  if (await getGuest(wedding)) return Response.json({ ok: true });
  const name = clean((await req.json().catch(() => null))?.name, 40);
  if (!name) return Response.json({ error: 'Please enter your name.' }, { status: 400 });
  const { count } = await db().from('guests').select('id', { count: 'exact', head: true }).eq('wedding_id', wedding.id);
  if ((count ?? 0) >= 2000) return Response.json({ error: 'This wedding is full.' }, { status: 429 });
  const token = newToken(), recovery = newToken();
  must(await db().from('guests').insert({
    wedding_id: wedding.id, display_name: name, token_hash: hashToken(token), recovery_token_hash: hashToken(recovery),
  }), 'join');
  await setGuestCookie(code, token);
  return Response.json({ ok: true, recovery });
}
