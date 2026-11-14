import { clientIp, otpEnabled, sendOtp } from '@/lib/otp';
import { normalisePhone } from '@/lib/phone';

/** Step one of sign-in by mobile number: text a six-digit code to it. */
export async function POST(req: Request) {
  if (!otpEnabled()) return Response.json({ error: 'Sign-in by mobile number is not available.' }, { status: 404 });
  const phone = normalisePhone((await req.json().catch(() => null))?.phone);
  if (!phone) return Response.json({ error: 'Enter a valid mobile number. For a number outside India, start with + and the country code.' }, { status: 400 });
  const error = await sendOtp(phone, clientIp(req));
  if (error) return Response.json({ error }, { status: 429 });
  return Response.json({ ok: true, phone });
}
