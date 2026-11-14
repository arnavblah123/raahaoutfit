import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { one, sql } from './db';
import { env } from './env';
import { googleEnabled } from './google';
import { otpEnabled } from './otp';

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
  require_approval: boolean; require_google: boolean;
};
export type Guest = {
  id: string; wedding_id: string; display_name: string; role: 'creator' | 'guest';
  status: 'approved' | 'pending' | 'rejected'; google_linked: boolean; phone: string | null;
};

/** Who is signed in on this browser: a mobile number proved by a one-time code, or a Google account. */
export type Identity = { phone?: string; sub?: string; email?: string | null; name?: string };
const ID_COOKIE = 'oc_id';
const idKey = () => new TextEncoder().encode(env.sessionSecret);

/** True when the app can sign people in. When false (nothing configured) guests join with just a name. */
export const signInEnabled = () => otpEnabled() || googleEnabled();

export async function setIdentity(id: Identity) {
  const token = await new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('90d').sign(idKey());
  (await cookies()).set(ID_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 90 * 24 * 3600,
  });
}
export async function clearIdentity() { (await cookies()).delete(ID_COOKIE); }
export async function getIdentity(): Promise<Identity | null> {
  const token = (await cookies()).get(ID_COOKIE)?.value;
  if (!token) return null;
  try {
    const id = (await jwtVerify(token, idKey(), { algorithms: ['HS256'] })).payload.id as Identity | undefined;
    return id && (id.phone || id.sub) ? id : null;
  } catch { return null; }
}

/** Where to send someone after sign-in: only ever a path inside this app. */
export const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?![\/\\])[\w\-/?=&%.]*$/.test(next) ? next : '/');

export async function getWedding(code: string): Promise<Wedding | null> {
  if (!/^[a-z0-9]{6,32}$/.test(code)) return null;
  return one<Wedding>(`select id, couple_names, wedding_date, city, join_code, colour_map_enabled, purge_after, purged_at, require_approval, require_google
                       from weddings where join_code = $1`, [code]);
}

const GUEST_COLS = 'id, wedding_id, display_name, role, status, google_sub is not null as google_linked, phone';

/**
 * The guest behind this browser for this wedding: the signed-in number or Google account first,
 * otherwise this wedding's own cookie (a guest from before sign-in existed, or a recovery link).
 */
export async function getGuest(wedding: Wedding): Promise<Guest | null> {
  const id = await getIdentity();
  if (id) {
    const g = await one<Guest>(
      `select ${GUEST_COLS} from guests where wedding_id = $1 and ((phone = $2 and phone_verified) or google_sub = $3)
       order by (google_sub = $3) desc nulls last limit 1`, [wedding.id, id.phone ?? null, id.sub ?? null]);
    if (g) return g;
  }
  const token = (await cookies()).get(cookieName(wedding.join_code))?.value;
  if (!token) return null;
  return one<Guest>(
    `select ${GUEST_COLS} from guests
     where wedding_id = $1 and (token_hash = $2 or recovery_token_hash = $2
                                or id in (select guest_id from guest_sessions where token_hash = $2))`, [wedding.id, hashToken(token)]);
}

/**
 * Someone who was already in a wedding on this browser (by name only) has now signed in:
 * attach the number or Google account to that guest, so her outfits follow her to any phone.
 */
export async function linkExistingGuest(code: string, id: Identity) {
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) return;
  const token = (await cookies()).get(cookieName(code))?.value;
  if (!token) return;
  const taken = await one(`select 1 from guests where wedding_id = $1 and (phone = $2 or google_sub = $3)`, [wedding.id, id.phone ?? null, id.sub ?? null]);
  if (taken) return;
  await sql(
    `update guests set phone = coalesce($3, phone), phone_verified = phone_verified or $3 is not null, google_sub = coalesce($4, google_sub), email = coalesce($5, email)
     where wedding_id = $1 and phone is null and google_sub is null
       and (token_hash = $2 or recovery_token_hash = $2 or id in (select guest_id from guest_sessions where token_hash = $2))`,
    [wedding.id, hashToken(token), id.phone ?? null, id.sub ?? null, id.email ?? null]);
}

export async function setGuestCookie(code: string, token: string) {
  (await cookies()).set(cookieName(code), token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: 60 * 60 * 24 * 365,
  });
}

/** Resolve wedding + guest for an API route, or return a ready error response. */
export async function requireGuest(code: string, opts: { allowPending?: boolean } = {}): Promise<
  { wedding: Wedding; guest: Guest; error?: undefined } | { error: Response }
> {
  const wedding = await getWedding(code);
  if (!wedding) return { error: Response.json({ error: 'Wedding not found' }, { status: 404 }) };
  if (wedding.purged_at) return { error: Response.json({ error: 'This wedding has ended' }, { status: 410 }) };
  const guest = await getGuest(wedding);
  if (!guest) return { error: Response.json({ error: 'Please join the wedding first' }, { status: 401 }) };
  if (guest.status !== 'approved' && !(opts.allowPending && guest.status === 'pending')) {
    return { error: Response.json({ error: 'The host has not approved you yet.' }, { status: 403 }) };
  }
  sql('update guests set last_seen_at = now() where id = $1', [guest.id]).catch(() => {});
  return { wedding, guest };
}
