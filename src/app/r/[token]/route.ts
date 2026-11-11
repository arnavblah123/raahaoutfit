import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { hashToken, setGuestCookie } from '@/lib/session';

/** Recovery link: puts the guest back into her wedding on a new phone or browser. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await db().from('guests').select('id, weddings(join_code)')
    .eq('recovery_token_hash', hashToken(token)).maybeSingle();
  const code = (data as any)?.weddings?.join_code;
  if (!code) redirect('/?recovery=invalid');
  await setGuestCookie(code, token);
  redirect(`/w/${code}`);
}
