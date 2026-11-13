import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { googleAuthUrl, googleEnabled } from '@/lib/google';
import { getWedding, newToken } from '@/lib/session';

/** Begin Google sign-in for one wedding. The join code travels in a short-lived, http-only cookie. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  const wedding = await getWedding(code);
  if (!googleEnabled() || !wedding || wedding.purged_at) redirect(wedding ? `/w/${code}` : '/');
  const state = newToken();
  (await cookies()).set('oc_oauth', JSON.stringify({ state, code }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  });
  redirect(googleAuthUrl(state));
}
