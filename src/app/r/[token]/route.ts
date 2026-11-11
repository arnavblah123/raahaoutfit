import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { hashToken, setGuestCookie } from '@/lib/session';

/** Recovery link: puts the guest back into her wedding on a new phone or browser. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await one<{ join_code: string }>(
    `select w.join_code from guests g join weddings w on w.id = g.wedding_id where g.recovery_token_hash = $1 and w.purged_at is null`, [hashToken(token)]);
  if (!row) redirect('/?recovery=invalid');
  await setGuestCookie(row.join_code, token);
  redirect(`/w/${row.join_code}`);
}
