import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { googleEnabled, googleIdentity } from '@/lib/google';
import { linkExistingGuest, safeNext, setIdentity } from '@/lib/session';

/** Google sends the person back here. From now on this browser is signed in as that Google account. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: string; next?: string } = {};
  try { saved = JSON.parse(jar.get('oc_oauth')?.value ?? '{}'); } catch { /* treated as invalid below */ }
  jar.delete('oc_oauth');
  if (!googleEnabled() || !saved.state) redirect('/');
  const next = safeNext(saved.next);
  const failed = `${next}${next.includes('?') ? '&' : '?'}signin=failed`;
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== saved.state) redirect(failed);

  let who;
  try { who = await googleIdentity(code); } catch { redirect(failed); }
  const id = { sub: who.sub, email: who.email, name: who.name };
  await setIdentity(id);
  const wedding = /^\/w\/([a-z0-9]+)/.exec(next);
  if (wedding) await linkExistingGuest(wedding[1], id);
  redirect(next);
}
