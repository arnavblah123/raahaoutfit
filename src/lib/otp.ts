/**
 * One-time codes by SMS. We make and check the code ourselves; the provider only delivers the text.
 *   OTP_PROVIDER=msg91    MSG91 (India). Needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.
 *   OTP_PROVIDER=webhook  POSTs {phone, code, message} as JSON to OTP_WEBHOOK_URL (any other SMS or WhatsApp sender).
 *   OTP_PROVIDER=log      Prints the code to the server log. Local development only; refused in production.
 * Unset: phone sign-in is switched off.
 */
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { one, sql } from './db';

const provider = () => (process.env.OTP_PROVIDER || '').toLowerCase();
export function otpEnabled() {
  const p = provider();
  if (p === 'msg91') return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
  if (p === 'webhook') return !!process.env.OTP_WEBHOOK_URL;
  if (p === 'log') return process.env.NODE_ENV !== 'production';
  return false;
}

const hash = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}:${process.env.SESSION_SECRET ?? ''}`).digest();
const TTL_MIN = 10;

async function deliver(phone: string, code: string) {
  const p = provider();
  if (p === 'log') { console.log(`[otp] ${phone} ${code}`); return; }
  let res: Response;
  if (p === 'msg91') {
    const u = new URL(process.env.MSG91_OTP_URL || 'https://control.msg91.com/api/v5/otp');
    u.search = new URLSearchParams({ template_id: process.env.MSG91_TEMPLATE_ID!, mobile: phone.slice(1), otp: code, otp_expiry: String(TTL_MIN) }).toString();
    res = await fetch(u, { method: 'POST', headers: { authkey: process.env.MSG91_AUTH_KEY!, 'content-type': 'application/json' }, body: '{}' });
    const data = await res.clone().json().catch(() => null);
    if (data?.type === 'error') throw new Error(`MSG91: ${data.message ?? 'refused'}`);   // MSG91 reports some errors with status 200
  } else {
    res = await fetch(process.env.OTP_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env.OTP_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.OTP_WEBHOOK_SECRET}` } : {}) },
      body: JSON.stringify({ phone, code, message: `${code} is your Outfit Clash code. It is valid for ${TTL_MIN} minutes.` }),
    });
  }
  if (!res.ok) throw new Error(`SMS provider answered ${res.status}`);
}

/** Send a code. Returns an error message for the person, or null when the SMS has gone. */
export async function sendOtp(phone: string, ip: string): Promise<string | null> {
  const c = await one<{ last30s: number; phone_hour: number; ip_hour: number; day: number }>(
    `select count(*) filter (where phone = $1 and not used and created_at > now() - interval '30 seconds') as last30s,
            count(*) filter (where phone = $1 and created_at > now() - interval '1 hour') as phone_hour,
            count(*) filter (where ip = $2 and created_at > now() - interval '1 hour') as ip_hour,
            count(*) as day
     from otp_codes where created_at > now() - interval '24 hours'`, [phone, ip]);
  if (c!.last30s > 0) return 'We just sent a code. Please wait half a minute before asking for another.';
  if (c!.phone_hour >= 5 || c!.ip_hour >= 15) return 'Too many codes requested. Please try again in an hour.';
  if (c!.day >= Number(process.env.OTP_DAILY_CAP || 3000)) return 'Sign-in by mobile number is busy right now. Please try again later.';
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const [row] = await sql<{ id: number }>(
    `insert into otp_codes (phone, code_hash, ip, expires_at) values ($1, $2, $3, now() + interval '${TTL_MIN} minutes') returning id`,
    [phone, hash(phone, code).toString('hex'), ip]);
  try { await deliver(phone, code); } catch (e: any) {
    console.error('otp delivery failed:', e.message);
    await sql('delete from otp_codes where id = $1', [row.id]);
    return 'We could not send the code. Check the number and try again.';
  }
  return null;
}

/** Check a code against the latest one sent to this number. Five wrong tries and the code is dead. */
export async function checkOtp(phone: string, code: string): Promise<string | null> {
  const row = await one<{ id: number; code_hash: string }>(
    `update otp_codes set attempts = attempts + 1
     where id = (select id from otp_codes where phone = $1 and not used and expires_at > now() order by created_at desc limit 1) and attempts < 5
     returning id, code_hash`, [phone]);
  if (!row) return 'That code has expired. Ask for a new one.';
  if (!/^\d{6}$/.test(code) || !timingSafeEqual(Buffer.from(row.code_hash, 'hex'), hash(phone, code))) return 'That code is not right.';
  await sql('update otp_codes set used = true where id = $1', [row.id]);
  return null;
}

export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
