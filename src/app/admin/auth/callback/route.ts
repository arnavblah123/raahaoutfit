import { redirect } from 'next/navigation';
import { authClient } from '@/lib/admin';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) redirect('/admin/login');
  const auth = await authClient();
  const { data, error } = await auth.auth.exchangeCodeForSession(code);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email || !env.adminEmails.includes(email)) {
    await auth.auth.signOut();
    redirect('/admin/login');
  }
  await db().from('admins').upsert({ email, user_id: data.user!.id, last_login_at: new Date().toISOString() });
  redirect('/admin');
}
