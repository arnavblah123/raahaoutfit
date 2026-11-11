import { db } from './db';
import type { Usage } from './ai';

export type UsageCtx = { outfit_id?: string; reference_outfit_id?: string; batch_job_id?: string };

/** Record token usage so cost per outfit (and per batch) can be reported. */
export async function logUsage(usage: Usage | undefined, ctx: UsageCtx) {
  if (!usage) return;
  await db().from('ai_usage').insert({ ...ctx, ...usage });
}
