/**
 * Process every running batch job until none are left. Resumable: stop it any time and run it again.
 *   npx tsx scripts/worker.ts
 */
import { bar, usd } from './_env';
import { db } from '../src/lib/db';
import { runJob } from '../src/lib/reference';

for (;;) {
  const { data } = await db().from('batch_jobs').select('id,kind').eq('status', 'running').order('created_at').limit(1);
  if (!data?.length) break;
  console.log(`Job ${data[0].kind} ${data[0].id}`);
  const job: any = await runJob(data[0].id, Date.now() + 12 * 3600_000, (j) => bar(j.done + j.failed, j.total, `spent ${usd(Number(j.cost_spent_usd))} of ${usd(Number(j.cost_cap_usd))}`));
  console.log(`\n${job.status}: ${job.done} processed, ${job.failed} failed.`);
  if (job.status === 'running') break;
}
console.log('No running jobs left.');
