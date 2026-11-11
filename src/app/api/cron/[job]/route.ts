import { cronAuthorised } from '@/lib/admin';
import { purgeExpired, raahaImport, recalcThreshold, vocabMergePass, workerTick } from '@/lib/jobs';
import { runJob } from '@/lib/reference';

export const maxDuration = 300;

/** Called by Vercel Cron (vercel.json), which sends the shared secret as a bearer token. */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!cronAuthorised(req)) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const deadline = Date.now() + 240_000;
  const { job } = await params;
  try {
    switch (job) {
      case 'purge': return Response.json(await purgeExpired());
      case 'raaha': {
        const r = await raahaImport();
        const done = await runJob(r.job.id, deadline);
        return Response.json({ ...r, job: done });
      }
      case 'reference-worker': return Response.json({ jobs: await workerTick(deadline) });
      case 'vocab': return Response.json(await vocabMergePass());
      case 'threshold': return Response.json(await recalcThreshold());
      default: return Response.json({ error: 'Unknown job' }, { status: 404 });
    }
  } catch (e: any) {
    console.error(`cron ${job} failed`, e);
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
export const POST = GET;
