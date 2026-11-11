/**
 * Process every running batch job until none are left. Resumable: stop it any time and run it again.
 *   npm run worker
 */
import { bar, usd } from './_env';
import { closeDb, one } from '../src/lib/db';
import { runJob } from '../src/lib/reference';

for (;;) {
  const next = await one(`select id, kind from batch_jobs where status = 'running' order by created_at limit 1`);
  if (!next) break;
  console.log(`Job ${next.kind} ${next.id}`);
  const job: any = await runJob(next.id, Date.now() + 12 * 3600_000, (j) => bar(j.done + j.failed, j.total, `spent ${usd(j.cost_spent_usd)} of ${usd(j.cost_cap_usd)}`));
  console.log(`\n${job.status}: ${job.done} processed, ${job.failed} failed.`);
  if (job.status === 'running') break;
}
console.log('No running jobs left.');
await closeDb();
