import { sql } from './db';
import type { Usage } from './ai';

export type UsageCtx = { outfit_id?: string; reference_outfit_id?: string; batch_job_id?: string };

/** Record token usage so cost per outfit (and per batch) can be reported. */
export async function logUsage(usage: Usage | undefined, ctx: UsageCtx) {
  if (!usage) return;
  await sql(`insert into ai_usage (outfit_id, reference_outfit_id, batch_job_id, step, model, input_tokens, output_tokens, cost_usd)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ctx.outfit_id ?? null, ctx.reference_outfit_id ?? null, ctx.batch_job_id ?? null, usage.step, usage.model, usage.input_tokens, usage.output_tokens, usage.cost_usd]);
}
