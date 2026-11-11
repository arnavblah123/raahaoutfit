/**
 * Pull the Raaha catalogue and process new products (Read + embed).
 *   npm run import:raaha -- --cap 1
 * The nightly cron job does the same through /api/cron/raaha.
 */
import { args, bar, usd } from './_env';
import { raahaImport } from '../src/lib/jobs';
import { closeDb } from '../src/lib/db';
import { runJob } from '../src/lib/reference';

const a = args();
const r = await raahaImport(a.cap ? Number(a.cap) : undefined);
console.log(`Feed: ${r.inFeed} products, ${r.fresh} new, ${r.removed} removed. Cost cap ${usd(r.job.cost_cap_usd)}.`);
const job: any = await runJob(r.job.id, Date.now() + 6 * 3600_000, (j) => bar(j.done + j.failed, j.total, `spent ${usd(j.cost_spent_usd)}`));
console.log(`\n${job.status}: ${job.done} processed, ${job.failed} failed, spent ${usd(job.cost_spent_usd)}.`);
await closeDb();
