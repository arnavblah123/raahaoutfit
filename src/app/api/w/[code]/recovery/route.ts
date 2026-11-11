import { sql } from '@/lib/db';
import { hashToken, newToken, requireGuest } from '@/lib/session';

/** Issue a fresh recovery link (the old one stops working). */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const r = await requireGuest((await params).code);
  if (r.error) return r.error;
  const recovery = newToken();
  await sql('update guests set recovery_token_hash = $1 where id = $2', [hashToken(recovery), r.guest.id]);
  return Response.json({ recovery });
}
