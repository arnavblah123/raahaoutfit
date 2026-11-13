/**
 * Optional Google sign-in for guests (OAuth 2.0 code flow, ID token verified against Google's keys).
 * Enabled only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. No outside auth service.
 * The GOOGLE_*_URL overrides exist for the automated tests only.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env';

const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const JWKS_URL = () => process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = () => (process.env.GOOGLE_ISSUER ? [process.env.GOOGLE_ISSUER] : ['https://accounts.google.com', 'accounts.google.com']);

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = () => `${env.appUrl}/api/auth/google/callback`;

export function googleAuthUrl(state: string) {
  const u = new URL(AUTH_URL());
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  }).toString();
  return u.toString();
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Exchange the code Google sent back and return the verified identity. */
export async function googleIdentity(code: string): Promise<{ sub: string; email: string | null; name: string }> {
  const res = await fetch(TOKEN_URL(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id_token) throw new Error('Google sign-in failed');
  jwks ??= createRemoteJWKSet(new URL(JWKS_URL()));
  const { payload } = await jwtVerify(data.id_token, jwks, { issuer: ISSUERS(), audience: process.env.GOOGLE_CLIENT_ID });
  if (!payload.sub) throw new Error('Google sign-in failed');
  const email = payload.email_verified && typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  const name = String(payload.given_name || payload.name || (email ? email.split('@')[0] : 'Guest')).slice(0, 40);
  return { sub: payload.sub, email, name };
}
