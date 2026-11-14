import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { googleAuthUrl, googleEnabled } from '@/lib/google';
import { newToken, safeNext } from '@/lib/session';

/** Begin Google sign-in. Where to go afterwards travels in a short-lived, http-only cookie. */
export async function GET(req: Request) {
  const next = safeNext(new URL(req.url).searchParams.get('next'));
  if (!googleEnabled()) redirect(next);
  const state = newToken();
  (await cookies()).set('oc_oauth', JSON.stringify({ state, next }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  });
  redirect(googleAuthUrl(state));
}
