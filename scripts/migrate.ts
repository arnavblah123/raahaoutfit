/**
 * Apply the SQL files in db/migrations, in order, once each.
 *   npm run db:migrate
 * Also runs automatically at the start of every build (see "build" in package.json), so a Vercel
 * deploy creates and updates the tables by itself.
 * Uses DATABASE_URL_UNPOOLED when set (Neon's direct connection), otherwise DATABASE_URL.
 */
import './_env';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  // During a build (--if-configured) a missing database is not an error: the build just skips this step.
  if (process.argv.includes('--if-configured')) { console.log('No DATABASE_URL set: skipping database migrations.'); process.exit(0); }
  console.error('Set DATABASE_URL'); process.exit(1);
}
const client = new Client({ connectionString: url });
await client.connect();
await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
const dir = path.join(process.cwd(), 'db', 'migrations');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await client.query('begin');
    // Two deploys building at once must not apply the same file twice.
    await client.query('select pg_advisory_xact_lock(748201)');
    if ((await client.query('select 1 from schema_migrations where name = $1', [file])).rowCount) {
      await client.query('commit'); console.log(`skip  ${file}`); continue;
    }
    await client.query(readFileSync(path.join(dir, file), 'utf8'));
    await client.query('insert into schema_migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`apply ${file}`);
  } catch (e: any) {
    await client.query('rollback').catch(() => {});
    console.error(`FAILED ${file}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log('Database is up to date.');
