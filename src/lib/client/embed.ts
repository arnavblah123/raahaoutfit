'use client';
/**
 * Compute photo embeddings on the guest's phone. Returns whatever succeeded;
 * anything missing is computed by the server instead, so this can fail safely.
 */
let worker: Worker | null = null;
const waiting = new Map<string, (v: number[] | null) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker('/embed-worker.js', { type: 'module' });
    worker.onmessage = (e) => { waiting.get(e.data.id)?.(e.data.embedding ?? null); waiting.delete(e.data.id); };
    worker.onerror = () => { waiting.forEach((r) => r(null)); waiting.clear(); worker = null; };
  }
  return worker;
}

export async function embedInBrowser(photos: { id: string; url: string }[], timeoutMs = 150_000): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  if ((process.env.NEXT_PUBLIC_EMBED_MODE || 'browser') !== 'browser' || typeof Worker === 'undefined') return out;
  const model = process.env.NEXT_PUBLIC_EMBED_MODEL || 'Marqo/marqo-fashionSigLIP';
  const dtype = process.env.NEXT_PUBLIC_EMBED_DTYPE || 'q8';
  try {
    const w = getWorker();
    await Promise.all(photos.map((p) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => { waiting.delete(p.id); resolve(); }, timeoutMs);
      waiting.set(p.id, (v) => { clearTimeout(timer); if (v) out[p.id] = v; resolve(); });
      w.postMessage({ id: p.id, url: p.url, model, dtype });
    })));
  } catch { /* fall back to the server */ }
  return out;
}
