/**
 * Postgres access (Neon, or any Postgres with pgvector). Server only.
 *   sql / one  -> run as the database owner
 *   asGuest    -> run as the restricted role, so row-level security limits a guest to her own rows
 */
import { Pool, types, type PoolClient } from 'pg';

types.setTypeParser(20, Number);                                     // bigint (counts)
types.setTypeParser(1700, Number);                                   // numeric (prices, costs)
types.setTypeParser(1082, (v) => v);                                 // date stays 'YYYY-MM-DD'
types.setTypeParser(1184, (v) => new Date(v).toISOString());         // timestamptz -> ISO string

let pool: Pool | null = null;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Missing environment variable DATABASE_URL');
    pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 5), idleTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('database pool error', e.message));
  }
  return pool;
}

export type Query = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;

export const sql: Query = async (text, params) => (await getPool().query(text, params as any[])).rows;
export async function one<T = any>(text: string, params?: unknown[]): Promise<T | null> {
  return (await sql<T>(text, params))[0] ?? null;
}

async function withClient<T>(setup: (c: PoolClient) => Promise<void>, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await setup(client);
    const out = await fn(async (text, params) => (await client.query(text, params as any[])).rows);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Several statements in one transaction, as the owner. */
export const transaction = <T>(fn: (q: Query) => Promise<T>) => withClient(async () => {}, fn);

/**
 * Everything a guest reads goes through here. The role and the two settings last only for this
 * transaction; app_guest can read nothing but her own rows, and can write nothing.
 */
export function asGuest<T>(guest: { id: string; wedding_id: string }, fn: (q: Query) => Promise<T>): Promise<T> {
  return withClient(async (c) => {
    await c.query("select set_config('app.guest_id', $1, true), set_config('app.wedding_id', $2, true)", [guest.id, guest.wedding_id]);
    await c.query('set local role app_guest');
  }, fn);
}

export async function closeDb() { await pool?.end(); pool = null; }
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const json = (v: unknown) => JSON.stringify(v);
