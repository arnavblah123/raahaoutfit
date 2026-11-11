import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { one, sql } from './db';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const cookieName = (code: string) => `oc_${code}`;

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
export function newJoinCode(len = 12) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export type Wedding = {
  id: string; couple_names: string; wedding_date: string; city: string; join_code: string;
  colour_map_enabled: boolean; purge_after: string; purged_at: string | null;
};
export type Guest = { id: string; wedding_id: string; display_name: string; role: 'creator' | 'guest' };

export async function getWedding(code: string): Promise<Wedding | null> {
  if (!/^[a-z0-9]{6,32}$/.test(code)) return null;
  return one<Wedding>(`select id, couple_names, wedding_date, city, join_code, colour_map_enabled, purge_after, purged_at
                       from weddings where join_code = $1`, [code]);
}

/** The guest behind this browser for this wedding, from the cookie (or a recovery token). */
export async function getGuest(wedding: Wedding): Promise<Guest | null> {
  const token = (await cookies()).get(cookieName(wedding.join_code))?.value;
  if (!token) return null;
  return one<Guest>(`select id, wedding_id, display_name, role from guests
                     where wedding_id = $1 and (token_hash = $2 or recovery_token_hash = $2)`, [wedding.id, hashToken(token)]);
}

export async function setGuestCookie(code: string, token: string) {
  (await cookies()).set(cookieName(code), token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: 60 * 60 * 24 * 365,
  });
}

/** Resolve wedding + guest for an API route, or return a ready error response. */
export async function requireGuest(code: string): Promise<
  { wedding: Wedding; guest: Guest; error?: undefined } | { error: Response }
> {
  const wedding = await getWedding(code);
  if (!wedding) return { error: Response.json({ error: 'Wedding not found' }, { status: 404 }) };
  if (wedding.purged_at) return { error: Response.json({ error: 'This wedding has ended' }, { status: 410 }) };
  const guest = await getGuest(wedding);
  if (!guest) return { error: Response.json({ error: 'Please join the wedding first' }, { status: 401 }) };
  sql('update guests set last_seen_at = now() where id = $1', [guest.id]).catch(() => {});
  return { wedding, guest };
}
