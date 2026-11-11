import { db, must } from '@/lib/db';
import { hashToken, newJoinCode, newToken, setGuestCookie } from '@/lib/session';
import { clean, parseFunctions } from '@/lib/weddings';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const couple = clean(body?.couple_names, 80), city = clean(body?.city, 60), name = clean(body?.creator_name, 40);
  const date = typeof body?.wedding_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.wedding_date) ? body.wedding_date : '';
  const functions = parseFunctions(body?.functions);
  if (!couple || !city || !name || !date) return Response.json({ error: 'Please fill in every field.' }, { status: 400 });
  if (!functions.length) return Response.json({ error: 'Add at least one function.' }, { status: 400 });
  if (new Date(date).getTime() < Date.now() - 24 * 3600 * 1000) return Response.json({ error: 'The wedding date is in the past.' }, { status: 400 });

  const code = newJoinCode();
  const wedding = must(await db().from('weddings').insert({
    couple_names: couple, wedding_date: date, city, join_code: code, colour_map_enabled: !!body?.colour_map_enabled,
  }).select('id').single(), 'create wedding') as any;
  must(await db().from('functions').insert(functions.map((f) => ({ ...f, wedding_id: wedding.id }))), 'create functions');
  const token = newToken(), recovery = newToken();
  must(await db().from('guests').insert({
    wedding_id: wedding.id, display_name: name, role: 'creator',
    token_hash: hashToken(token), recovery_token_hash: hashToken(recovery),
  }), 'create guest');
  await setGuestCookie(code, token);
  return Response.json({ code, recovery });
}
