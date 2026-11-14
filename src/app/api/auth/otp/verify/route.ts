import { checkOtp, otpEnabled } from '@/lib/otp';
import { normalisePhone } from '@/lib/phone';
import { linkExistingGuest, safeNext, setIdentity } from '@/lib/session';

/** Step two: the code matches, so this browser is signed in as that number. */
export async function POST(req: Request) {
  if (!otpEnabled()) return Response.json({ error: 'Sign-in by mobile number is not available.' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const phone = normalisePhone(body?.phone);
  if (!phone) return Response.json({ error: 'Enter a valid mobile number.' }, { status: 400 });
  const error = await checkOtp(phone, String(body?.code ?? '').replace(/\D/g, ''));
  if (error) return Response.json({ error }, { status: 400 });
  const id = { phone };
  await setIdentity(id);
  const wedding = /^\/w\/([a-z0-9]+)/.exec(safeNext(body?.next));
  if (wedding) await linkExistingGuest(wedding[1], id);
  return Response.json({ ok: true });
}
