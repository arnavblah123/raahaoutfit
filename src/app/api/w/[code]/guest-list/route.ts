import { one, sql } from '@/lib/db';
import { normalisePhone, parseGuestRows } from '@/lib/phone';
import { requireGuest } from '@/lib/session';

async function host(code: string) {
  const r = await requireGuest(code);
  if (r.error) return r;
  if (r.guest.role !== 'creator') return { error: Response.json({ error: 'Only the host can do this.' }, { status: 403 }) };
  return r;
}

/** The host adds numbers to the guest list (from a sheet, pasted, or picked from contacts). */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const r = await host((await params).code);
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.entries)) return Response.json({ error: 'No numbers found.' }, { status: 400 });
  const { entries } = parseGuestRows(body.entries.slice(0, 5000).map((e: any) => [e?.phone, e?.name]));
  if (!entries.length) return Response.json({ error: 'No valid mobile numbers found.' }, { status: 400 });
  const have = (await one<{ n: number }>('select count(*) as n from guest_list where wedding_id = $1', [r.wedding.id]))?.n ?? 0;
  if (have + entries.length > 3000) return Response.json({ error: 'A guest list can hold 3,000 numbers.' }, { status: 400 });
  const added = await sql(
    `insert into guest_list (wedding_id, phone, name) select $1, * from unnest($2::text[], $3::text[]) on conflict do nothing returning phone`,
    [r.wedding.id, entries.map((e) => e.phone), entries.map((e) => e.name)]);
  // Anyone who was waiting with one of these numbers is let in.
  await sql(`update guests set status = 'approved' where wedding_id = $1 and status = 'pending' and phone = any($2::text[])`,
    [r.wedding.id, entries.map((e) => e.phone)]);
  return Response.json({ ok: true, added: added.length, already: entries.length - added.length });
}

/** Take a number off the list. Someone who has already joined with it stays in. */
export async function DELETE(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const r = await host((await params).code);
  if (r.error) return r.error;
  const phone = normalisePhone((await req.json().catch(() => null))?.phone);
  if (phone) await sql('delete from guest_list where wedding_id = $1 and phone = $2', [r.wedding.id, phone]);
  return Response.json({ ok: true });
}
