import { isUuid, sql } from '@/lib/db';
import { requireGuest } from '@/lib/session';

/** The host approves or declines someone who asked to join. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; guestId: string }> }) {
  const { code, guestId } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  if (r.guest.role !== 'creator') return Response.json({ error: 'Only the host can do this.' }, { status: 403 });
  const action = (await req.json().catch(() => ({}))).action;
  if (!isUuid(guestId) || !['approve', 'reject'].includes(action)) return Response.json({ error: 'Not found' }, { status: 404 });
  await sql(`update guests set status = $3 where id = $1 and wedding_id = $2 and role <> 'creator' and status in ('pending', 'rejected')`,
    [guestId, r.wedding.id, action === 'approve' ? 'approved' : 'rejected']);
  return Response.json({ ok: true });
}
