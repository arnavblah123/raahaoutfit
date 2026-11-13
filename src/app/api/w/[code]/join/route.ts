import { one, sql } from '@/lib/db';
import { getGuest, getWedding, hashToken, newToken, setGuestCookie } from '@/lib/session';
import { googleEnabled } from '@/lib/google';
import { clean } from '@/lib/weddings';

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) return Response.json({ error: 'This wedding link is not active.' }, { status: 404 });
  if (await getGuest(wedding)) return Response.json({ ok: true });
  if (wedding.require_google && googleEnabled()) return Response.json({ error: 'The host asks guests to sign in with Google for this wedding.' }, { status: 403 });
  const name = clean((await req.json().catch(() => null))?.name, 40);
  if (!name) return Response.json({ error: 'Please enter your name.' }, { status: 400 });
  const count = await one<{ n: number }>('select count(*) as n from guests where wedding_id = $1', [wedding.id]);
  if ((count?.n ?? 0) >= 2000) return Response.json({ error: 'This wedding is full.' }, { status: 429 });
  const token = newToken(), recovery = newToken();
  await sql('insert into guests (wedding_id, display_name, status, token_hash, recovery_token_hash) values ($1, $2, $3, $4, $5)',
    [wedding.id, name, wedding.require_approval ? 'pending' : 'approved', hashToken(token), hashToken(recovery)]);
  await setGuestCookie(code, token);
  return Response.json({ ok: true, recovery });
}
