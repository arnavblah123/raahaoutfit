import { transaction } from '@/lib/db';
import { parseGuestRows } from '@/lib/phone';
import { getIdentity, hashToken, newJoinCode, newToken, setGuestCookie, signInEnabled } from '@/lib/session';
import { clean, parseFunctions } from '@/lib/weddings';

export async function POST(req: Request) {
  const id = await getIdentity();
  if (signInEnabled() && !id) return Response.json({ error: 'Please sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const couple = clean(body?.couple_names, 80), city = clean(body?.city, 60), name = clean(body?.creator_name, 40);
  const date = typeof body?.wedding_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.wedding_date) && !Number.isNaN(Date.parse(body.wedding_date)) ? body.wedding_date : '';
  const functions = parseFunctions(body?.functions);
  if (!couple || !city || !name || !date) return Response.json({ error: 'Please fill in every field.' }, { status: 400 });
  if (!functions.length) return Response.json({ error: 'Add at least one function.' }, { status: 400 });
  if (new Date(date).getTime() < Date.now() - 24 * 3600 * 1000) return Response.json({ error: 'The wedding date is in the past.' }, { status: 400 });
  const list = Array.isArray(body?.guest_list)
    ? parseGuestRows(body.guest_list.slice(0, 5000).map((e: any) => [e?.phone, e?.name])).entries.slice(0, 3000) : [];

  const code = newJoinCode(), token = newToken(), recovery = newToken();
  await transaction(async (q) => {
    const [w] = await q<{ id: string }>(
      'insert into weddings (couple_names, wedding_date, city, join_code, colour_map_enabled, require_approval) values ($1, $2, $3, $4, $5, $6) returning id',
      [couple, date, city, code, !!body?.colour_map_enabled, !!body?.require_approval]);
    for (const f of functions) await q('insert into functions (wedding_id, kind, custom_name, sort) values ($1, $2, $3, $4)', [w.id, f.kind, f.custom_name, f.sort]);
    await q(`insert into guests (wedding_id, display_name, role, phone, phone_verified, google_sub, email, token_hash, recovery_token_hash)
             values ($1, $2, 'creator', $3, $4, $5, $6, $7, $8)`,
      [w.id, name, id?.phone ?? null, !!id?.phone, id?.sub ?? null, id?.email ?? null, hashToken(token), hashToken(recovery)]);
    if (list.length) {
      await q(`insert into guest_list (wedding_id, phone, name) select $1, * from unnest($2::text[], $3::text[]) on conflict do nothing`,
        [w.id, list.map((e) => e.phone), list.map((e) => e.name)]);
    }
  });
  if (!id) await setGuestCookie(code, token);
  return Response.json({ code, recovery: id ? null : recovery, listed: list.length });
}
