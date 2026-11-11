import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from './env';

/** Supabase Auth client bound to the request cookies. Used only for admin login. */
export async function authClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only in server components */ } },
    },
  });
}

/** The signed-in admin's email, or null. Admins are the emails listed in ADMIN_EMAILS. */
export async function getAdmin(): Promise<string | null> {
  const { data } = await (await authClient()).auth.getUser();
  const email = data.user?.email?.toLowerCase();
  return email && env.adminEmails.includes(email) ? email : null;
}

export async function requireAdmin(): Promise<{ email: string; error?: undefined } | { error: Response }> {
  const email = await getAdmin();
  return email ? { email } : { error: Response.json({ error: 'Admin sign-in required' }, { status: 401 }) };
}

export function cronAuthorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}
