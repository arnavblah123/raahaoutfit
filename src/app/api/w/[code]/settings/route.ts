import { db, must } from '@/lib/db';
import { requireGuest } from '@/lib/session';
import { parseFunctions } from '@/lib/weddings';

/** Creator only: colour map toggle, add or remove functions. */
export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const r = await requireGuest((await params).code);
  if (r.error) return r.error;
  if (r.guest.role !== 'creator') return Response.json({ error: 'Only the creator can change this.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.colour_map_enabled === 'boolean') {
    must(await db().from('weddings').update({ colour_map_enabled: body.colour_map_enabled }).eq('id', r.wedding.id));
  }
  if (body.add_function) {
    const [f] = parseFunctions([body.add_function]);
    if (!f) return Response.json({ error: 'Give the function a name.' }, { status: 400 });
    const { count } = await db().from('functions').select('id', { count: 'exact', head: true }).eq('wedding_id', r.wedding.id);
    if ((count ?? 0) >= 12) return Response.json({ error: 'That is the maximum number of functions.' }, { status: 400 });
    must(await db().from('functions').insert({ ...f, sort: count ?? 0, wedding_id: r.wedding.id }));
  }
  if (typeof body.remove_function === 'string') {
    const { count } = await db().from('outfits').select('id', { count: 'exact', head: true }).eq('function_id', body.remove_function);
    if (count) return Response.json({ error: 'Guests have already added outfits to that function.' }, { status: 409 });
    must(await db().from('functions').delete().eq('id', body.remove_function).eq('wedding_id', r.wedding.id));
  }
  return Response.json({ ok: true });
}
