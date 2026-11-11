import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { env } from './env';

let _admin: SupabaseClient | null = null;

/** Service-role client. Server only. Bypasses row-level security. */
export function db(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/**
 * Client scoped to one guest. Row-level security limits it to her own rows and photos.
 * Used for everything a guest reads, so a bug in a query cannot leak another guest's data.
 */
export function guestDb(guest: { id: string; wedding_id: string }): SupabaseClient {
  const secret = new TextEncoder().encode(env.supabaseJwtSecret);
  const token = () =>
    new SignJWT({ role: 'authenticated', guest_id: guest.id, wedding_id: guest.wedding_id })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(guest.id)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret);
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    accessToken: token,
    auth: { persistSession: false, autoRefreshToken: false },
  } as any);
}

export function must<T>(res: { data: T | null; error: any }, what = 'query'): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}
