import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { db } from './db';

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
  const { data } = await db().from('weddings').select('*').eq('join_code', code).maybeSingle();
  return data;
}

/** The guest behind this browser for this wedding, from the cookie (or a recovery token). */
export async function getGuest(wedding: Wedding): Promise<Guest | null> {
  const token = (await cookies()).get(cookieName(wedding.join_code))?.value;
  if (!token) return null;
  const h = hashToken(token);
  const { data } = await db().from('guests').select('id,wedding_id,display_name,role')
    .eq('wedding_id', wedding.id).or(`token_hash.eq.${h},recovery_token_hash.eq.${h}`).maybeSingle();
  return data;
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
  db().from('guests').update({ last_seen_at: new Date().toISOString() }).eq('id', guest.id).then(() => {});
  return { wedding, guest };
}
