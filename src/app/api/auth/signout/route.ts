import { cookies } from 'next/headers';
import { clearIdentity } from '@/lib/session';

/** Sign out of this browser: forget who is signed in and every wedding cookie. */
export async function POST() {
  const jar = await cookies();
  for (const c of jar.getAll()) if (/^oc_[a-z0-9]{6,32}$/.test(c.name) && c.name !== 'oc_admin') jar.delete(c.name);
  await clearIdentity();
  return Response.json({ ok: true });
}
