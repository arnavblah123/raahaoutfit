import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { one, sql } from '@/lib/db';
import { googleEnabled, googleIdentity } from '@/lib/google';
import { getGuest, getWedding, hashToken, newToken, setGuestCookie } from '@/lib/session';

/** Google sends the guest back here. Find her guest record for this wedding, link it, or create it. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: string; code?: string } = {};
  try { saved = JSON.parse(jar.get('oc_oauth')?.value ?? '{}'); } catch { /* treated as invalid below */ }
  jar.delete('oc_oauth');
  const wedding = saved.code ? await getWedding(saved.code) : null;
  if (!googleEnabled() || !wedding || wedding.purged_at) redirect('/');
  const back = `/w/${wedding.join_code}`;
  const code = url.searchParams.get('code');
  if (!code || !saved.state || url.searchParams.get('state') !== saved.state) redirect(`${back}?signin=failed`);

  let who;
  try { who = await googleIdentity(code); } catch { redirect(`${back}?signin=failed`); }

  // 1. She has signed in to this wedding with Google before: open a session on this device.
  let guest = await one<{ id: string }>('select id from guests where wedding_id = $1 and google_sub = $2', [wedding.id, who.sub]);
  if (!guest) {
    // 2. This browser already holds a name-only guest: attach Google to it.
    const current = await getGuest(wedding);
    if (current && !current.google_linked) {
      await sql('update guests set google_sub = $2, email = $3 where id = $1', [current.id, who.sub, who.email]);
      redirect(back);
    }
    // 3. New guest.
    const count = await one<{ n: number }>('select count(*) as n from guests where wedding_id = $1', [wedding.id]);
    if ((count?.n ?? 0) >= 2000) redirect(`${back}?signin=full`);
    guest = await one<{ id: string }>(
      `insert into guests (wedding_id, display_name, status, google_sub, email, token_hash, recovery_token_hash)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [wedding.id, who.name, wedding.require_approval ? 'pending' : 'approved', who.sub, who.email, hashToken(newToken()), hashToken(newToken())]);
  }
  const token = newToken();
  await sql('insert into guest_sessions (token_hash, guest_id) values ($1, $2)', [hashToken(token), guest!.id]);
  await setGuestCookie(wedding.join_code, token);
  redirect(back);
}
