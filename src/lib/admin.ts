/** Admin sign-in: one password (ADMIN_PASSWORD) and a signed session cookie. No outside auth service. */
import { cookies } from 'next/headers';
import { createHash, timingSafeEqual } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { one, sql } from './db';
import { env } from './env';

const COOKIE = 'oc_admin';
const key = () => new TextEncoder().encode(env.sessionSecret);
const digest = (s: string) => createHash('sha256').update(s).digest();

/** Returns an error message, or null when signed in. Failed attempts are rate limited. */
export async function adminLogin(password: string): Promise<string | null> {
  const recent = await one<{ n: number }>(
    `select count(*) as n from rate_limit_events where action = 'admin_login_failed' and created_at > now() - interval '15 minutes'`);
  if ((recent?.n ?? 0) >= 8) return 'Too many attempts. Try again in 15 minutes.';
  if (!timingSafeEqual(digest(password), digest(env.adminPassword))) {
    await sql(`insert into rate_limit_events (action) values ('admin_login_failed')`);
    return 'Wrong password.';
  }
  const token = await new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600,
  });
  return null;
}

export async function adminLogout() { (await cookies()).delete(COOKIE); }

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try {
    return (await jwtVerify(token, key(), { algorithms: ['HS256'] })).payload.role === 'admin';
  } catch { return false; }
}

export async function requireAdmin(): Promise<{ error?: Response }> {
  return (await isAdmin()) ? {} : { error: Response.json({ error: 'Admin sign-in required' }, { status: 401 }) };
}

/** Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when that variable is set. */
export function cronAuthorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}
