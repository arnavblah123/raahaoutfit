import { db } from './db';

/** Returns an error message if the guest or the wedding is over its daily limit. */
export async function checkRate(action: string, guestId: string, weddingId: string, perGuest: number, perWedding: number) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = async (col: 'guest_id' | 'wedding_id', id: string) => {
    const { count } = await db().from('rate_limit_events').select('id', { count: 'exact', head: true })
      .eq(col, id).eq('action', action).gte('created_at', since);
    return count ?? 0;
  };
  const [g, w] = await Promise.all([count('guest_id', guestId), count('wedding_id', weddingId)]);
  if (g >= perGuest) return 'You have added a lot of photos today. Please try again tomorrow.';
  if (w >= perWedding) return 'This wedding has reached its daily upload limit. Please try again tomorrow.';
  await db().from('rate_limit_events').insert({ guest_id: guestId, wedding_id: weddingId, action });
  return null;
}
