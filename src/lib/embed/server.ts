/**
 * Marqo-FashionSigLIP image embeddings on the server.
 * Guests' phones normally compute their own vectors (public/embed-worker.js). This module
 * covers the fallback, and all reference data, scripts and batch jobs.
 *   EMBED_URL set  -> call the small embedding server (scripts/embed-server.ts)
 *   otherwise      -> run the ONNX model in this process with transformers.js
 */
import { EMBED_DIM, env } from '../env';

let pipe: Promise<{ processor: any; model: any; RawImage: any }> | null = null;

async function load() {
  if (!pipe) {
    pipe = (async () => {
      const t: any = await import('@huggingface/transformers');
      if (process.env.VERCEL) t.env.cacheDir = '/tmp/hf-cache';
      const [processor, model] = await Promise.all([
        t.AutoProcessor.from_pretrained(env.embedModel),
        t.SiglipVisionModel.from_pretrained(env.embedModel, { dtype: env.embedDtype }),
      ]);
      return { processor, model, RawImage: t.RawImage };
    })();
    pipe.catch(() => { pipe = null; });
  }
  return pipe;
}

export function normaliseVector(v: number[]): number[] | null {
  if (!Array.isArray(v) || v.length !== EMBED_DIM || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const len = Math.sqrt(v.reduce((s, n) => s + n * n, 0));
  if (!(len > 0)) return null;
  return v.map((n) => n / len);
}

export const toPgVector = (v: number[]) => `[${v.map((n) => n.toFixed(6)).join(',')}]`;
export const embeddingModelTag = () => `${env.embedModel}:${env.embedDtype}`;

export async function embedImage(jpeg: Buffer): Promise<number[]> {
  if (env.embedUrl) {
    const res = await fetch(env.embedUrl.replace(/\/$/, '') + '/embed', {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${process.env.EMBED_SECRET ?? ''}` },
      body: new Uint8Array(jpeg),
    });
    if (!res.ok) throw new Error(`Embedding server returned ${res.status}`);
    const v = normaliseVector((await res.json()).embedding);
    if (!v) throw new Error('Embedding server returned a bad vector');
    return v;
  }
  const { processor, model, RawImage } = await load();
  const img = await RawImage.fromBlob(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
  const out = await model(await processor(img));
  const tensor = out.image_embeds ?? out.pooler_output;
  const v = normaliseVector(Array.from(tensor.data as Float32Array).slice(0, EMBED_DIM));
  if (!v) throw new Error('Model returned a vector of unexpected size');
  return v;
}
