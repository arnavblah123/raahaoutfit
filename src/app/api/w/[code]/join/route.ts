import { one, sql } from '@/lib/db';
import { normalisePhone } from '@/lib/phone';
import { getGuest, getIdentity, getWedding, hashToken, newToken, setGuestCookie, signInEnabled } from '@/lib/session';
import { clean } from '@/lib/weddings';

/**
 * Enter a wedding. The person is already signed in (mobile number or Google).
 * A number on the host's guest list gets straight in; anyone else asks the host, unless the host lets everyone in.
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) return Response.json({ error: 'This wedding link is not active.' }, { status: 404 });
  if (await getGuest(wedding)) return Response.json({ ok: true });
  const body = await req.json().catch(() => null);
  const count = await one<{ n: number }>('select count(*) as n from guests where wedding_id = $1', [wedding.id]);
  if ((count?.n ?? 0) >= 2000) return Response.json({ error: 'This wedding is full.' }, { status: 429 });
  const token = newToken(), recovery = newToken();

  if (!signInEnabled()) {
    // No sign-in configured on this deployment: join with a name, as before.
    const name = clean(body?.name, 40);
    if (!name) return Response.json({ error: 'Please enter your name.' }, { status: 400 });
    await sql('insert into guests (wedding_id, display_name, status, token_hash, recovery_token_hash) values ($1, $2, $3, $4, $5)',
      [wedding.id, name, wedding.require_approval ? 'pending' : 'approved', hashToken(token), hashToken(recovery)]);
    await setGuestCookie(code, token);
    return Response.json({ ok: true, recovery });
  }

  const id = await getIdentity();
  if (!id) return Response.json({ error: 'Please sign in first.' }, { status: 401 });
  const phone = id.phone ?? normalisePhone(body?.phone);
  if (!phone) return Response.json({ error: 'Enter your mobile number. For a number outside India, start with + and the country code.' }, { status: 400 });
  const listed = await one<{ name: string | null }>('select name from guest_list where wedding_id = $1 and phone = $2', [wedding.id, phone]);
  const name = clean(body?.name, 40) || clean(id.name, 40) || clean(listed?.name, 40);
  if (!name) return Response.json({ error: 'Please enter your name.' }, { status: 400 });

  const holder = await one<{ id: string }>('select id from guests where wedding_id = $1 and phone = $2', [wedding.id, phone]);
  if (holder) {
    // Someone entered this number with a Google account, without proving it.
    if (!id.phone) return Response.json({ error: 'That number has already been used for this wedding. Sign out and sign in with the mobile number instead.' }, { status: 409 });
    // The person who has now proved the number owns it: the unproved Google account is detached.
    await sql('update guests set phone_verified = true, google_sub = null, email = null where id = $1', [holder.id]);
    await sql('delete from guest_sessions where guest_id = $1', [holder.id]);
    return Response.json({ ok: true });
  }
  const status = listed || !wedding.require_approval ? 'approved' : 'pending';
  await sql(
    `insert into guests (wedding_id, display_name, status, phone, phone_verified, google_sub, email, token_hash, recovery_token_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [wedding.id, name, status, phone, !!id.phone, id.sub ?? null, id.email ?? null, hashToken(token), hashToken(recovery)]);
  return Response.json({ ok: true });
}
