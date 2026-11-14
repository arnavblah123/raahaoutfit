import { isUuid, one, sql } from '@/lib/db';
import { requireGuest } from '@/lib/session';
import { parseFunctions } from '@/lib/weddings';

/** Creator only: colour map toggle, add or remove functions. */
export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const r = await requireGuest((await params).code);
  if (r.error) return r.error;
  if (r.guest.role !== 'creator') return Response.json({ error: 'Only the creator can change this.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.colour_map_enabled === 'boolean') {
    await sql('update weddings set colour_map_enabled = $1 where id = $2', [body.colour_map_enabled, r.wedding.id]);
  }
  for (const key of ['require_approval'] as const) {
    if (typeof body[key] === 'boolean') await sql(`update weddings set ${key} = $1 where id = $2`, [body[key], r.wedding.id]);
  }
  // Opening the wedding to everyone lets in everyone who was waiting.
  if (body.require_approval === false) await sql(`update guests set status = 'approved' where wedding_id = $1 and status = 'pending'`, [r.wedding.id]);
  if (body.add_function) {
    const [f] = parseFunctions([body.add_function]);
    if (!f) return Response.json({ error: 'Give the function a name.' }, { status: 400 });
    const count = (await one<{ n: number }>('select count(*) as n from functions where wedding_id = $1', [r.wedding.id]))?.n ?? 0;
    if (count >= 12) return Response.json({ error: 'That is the maximum number of functions.' }, { status: 400 });
    await sql('insert into functions (wedding_id, kind, custom_name, sort) values ($1, $2, $3, $4)', [r.wedding.id, f.kind, f.custom_name, count]);
  }
  if (isUuid(body.remove_function)) {
    const used = await one('select 1 from outfits where function_id = $1 limit 1', [body.remove_function]);
    if (used) return Response.json({ error: 'Guests have already added outfits to that function.' }, { status: 409 });
    await sql('delete from functions where id = $1 and wedding_id = $2', [body.remove_function, r.wedding.id]);
  }
  return Response.json({ ok: true });
}
