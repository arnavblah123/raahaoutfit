import { one, sql } from './db';

/** Returns an error message if the guest or the wedding is over its daily limit. */
export async function checkRate(action: string, guestId: string, weddingId: string, perGuest: number, perWedding: number) {
  const c = await one<{ g: number; w: number }>(
    `select count(*) filter (where guest_id = $1) as g, count(*) filter (where wedding_id = $2) as w
     from rate_limit_events where action = $3 and created_at > now() - interval '24 hours' and (guest_id = $1 or wedding_id = $2)`,
    [guestId, weddingId, action]);
  if ((c?.g ?? 0) >= perGuest) return 'You have added a lot of photos today. Please try again tomorrow.';
  if ((c?.w ?? 0) >= perWedding) return 'This wedding has reached its daily upload limit. Please try again tomorrow.';
  await sql('insert into rate_limit_events (guest_id, wedding_id, action) values ($1, $2, $3)', [guestId, weddingId, action]);
  return null;
}
