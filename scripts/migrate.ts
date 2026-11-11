/**
 * Apply the SQL files in db/migrations, in order, once each.
 *   npm run db:migrate
 * Uses DATABASE_URL_UNPOOLED when set (Neon's direct connection), otherwise DATABASE_URL.
 */
import './_env';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }
const client = new Client({ connectionString: url });
await client.connect();
await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
const dir = path.join(process.cwd(), 'db', 'migrations');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) { console.log(`skip  ${file}`); continue; }
  try {
    await client.query('begin');
    await client.query(readFileSync(path.join(dir, file), 'utf8'));
    await client.query('insert into schema_migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`apply ${file}`);
  } catch (e: any) {
    await client.query('rollback');
    console.error(`FAILED ${file}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log('Database is up to date.');
