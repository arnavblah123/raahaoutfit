'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { finishIndofashionUpload, openIndofashionJob, uploadIndofashionBatch } from '@/app/admin/actions';
import { embedInBrowser } from '@/lib/client/embed';
import { canonicalClass } from '@/lib/indofashion';

type Item = { file: File; path: string; label: string; cls: string };
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '');

/** Small stable hash, so the same folder and sample size always pick the same images (re-runs resume). */
function rank(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  return new Promise((r, reject) => canvas.toBlob((b) => (b ? r(b) : reject(new Error('Could not read image'))), 'image/jpeg', 0.82));
}

/** Read labels from the dataset's metadata file (one JSON object per line, or a JSON array). */
async function readMetadata(file: File): Promise<Map<string, string>> {
  const text = (await file.text()).trim();
  const rows: any[] = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const map = new Map<string, string>();
  for (const r of rows) if (r?.image_path && r?.class_label) map.set(norm(String(r.image_path)), String(r.class_label));
  return map;
}
function labelFor(path: string, meta: Map<string, string> | null) {
  const parts = norm(path).split('/');
  if (!meta) return parts.length > 1 ? parts[parts.length - 2] : '';
  // The folder the admin picked may sit above or below the paths used in the metadata file.
  for (let i = 0; i < parts.length; i++) { const hit = meta.get(parts.slice(i).join('/')); if (hit) return hit; }
  return '';
}

export function IndofashionImporter({ defaultCap }: { defaultCap: number }) {
  const router = useRouter();
  const folder = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [metaFile, setMetaFile] = useState<File | null>(null);
  const [n, setN] = useState('500');
  const [capUsd, setCapUsd] = useState(String(defaultCap));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [summary, setSummary] = useState('');

  async function plan(): Promise<Item[]> {
    const meta = metaFile ? await readMetadata(metaFile) : null;
    const byClass = new Map<string, Item[]>();
    for (const file of files) {
      if (!/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
      const path = norm((file as any).webkitRelativePath || file.name);
      const label = labelFor(path, meta);
      const cls = label ? canonicalClass(label) : null;
      if (!cls) continue;                                   // men's classes, accessories, unlabelled files
      (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push({ file, path, label, cls });
    }
    const classes = [...byClass.keys()].sort();
    const per = Math.ceil(Number(n) / Math.max(1, classes.length));
    setSummary(classes.length ? classes.map((c) => `${c} (${byClass.get(c)!.length})`).join(', ') : '');
    return classes.flatMap((c) => byClass.get(c)!.sort((a, b) => rank(a.path) - rank(b.path)).slice(0, per)).slice(0, Number(n));
  }

  async function run(pilot: boolean) {
    setBusy(true); setMsg('');
    try {
      const picked = await plan();
      if (!picked.length) throw new Error("No women's garment images found. Pick the dataset's top folder, and add the metadata file if images are not in one folder per class.");
      const job = await openIndofashionJob(Number(capUsd), picked.length, pilot);
      if (!job.ok) throw new Error(job.error);
      let done = 0;
      setProgress({ done, total: picked.length });
      for (let i = 0; i < picked.length; i += 6) {
        const chunk = picked.slice(i, i + 6);
        const blobs = await Promise.all(chunk.map((c) => shrink(c.file).catch(() => null)));
        const urls = blobs.map((b) => (b ? URL.createObjectURL(b) : ''));
        // Vectors are computed here when browser mode is on; otherwise the server computes them.
        const vectors = await embedInBrowser(urls.map((url, k) => ({ id: String(k), url })).filter((u) => u.url), 120_000);
        urls.forEach((u) => u && URL.revokeObjectURL(u));
        const form = new FormData();
        form.set('job_id', job.jobId);
        const meta: unknown[] = [];
        chunk.forEach((c, k) => { if (blobs[k]) { form.append('images', blobs[k]!, 'image.jpg'); meta.push({ external_id: c.path, label: c.label, embedding: vectors[String(k)] }); } });
        form.set('meta', JSON.stringify(meta));
        const r = await uploadIndofashionBatch(form);
        if (!r.ok) throw new Error(r.error);
        done += chunk.length;
        setProgress({ done, total: picked.length });
      }
      const fin = await finishIndofashionUpload(job.jobId, pilot);
      if (!fin.ok) throw new Error(fin.error);
      setMsg(pilot
        ? `${fin.total} images loaded. Reading has started below; keep this page open until the bar is full.`
        : `${fin.total} images loaded. The batch is waiting below: check the estimate, set the cap and press "Approve and start".`);
      router.refresh();
    } catch (e: any) {
      setMsg(`${e?.message ?? e} You can press the button again; images already loaded are skipped.`);
    }
    setBusy(false);
  }

  const images = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name)).length;
  return (
    <div className="card space-y-3">
      <p className="font-medium">Load images from the dataset folder on this computer</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Choose the unpacked dataset folder. Nothing is uploaded until you press a button below.</li>
        <li>If the dataset came with a metadata file (rows with <code>image_path</code> and <code>class_label</code>), choose it too. Without it, each image's folder name is used as its label.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="btn-ghost btn-sm cursor-pointer">Choose dataset folder
          <input ref={folder} type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setSummary(''); }} /></label>
        <span className="text-muted">{images ? `${images} images found` : 'No folder chosen'}</span>
        <label className="btn-ghost btn-sm cursor-pointer">Metadata file (optional)
          <input type="file" accept=".json,.jsonl,.txt" className="hidden" onChange={(e) => setMetaFile(e.target.files?.[0] ?? null)} /></label>
        <span className="text-muted">{metaFile?.name ?? ''}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-muted" htmlFor="indo-n">Images</label>
        <input id="indo-n" className="w-24 rounded-lg border border-line bg-white px-2 py-1.5" value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" />
        <label className="text-muted" htmlFor="indo-cap">Cost cap (USD)</label>
        <input id="indo-cap" className="w-20 rounded-lg border border-line bg-white px-2 py-1.5" value={capUsd} onChange={(e) => setCapUsd(e.target.value)} inputMode="decimal" />
        <button className="btn-primary btn-sm" disabled={busy || !images} onClick={() => run(true)}>Run as pilot (starts now)</button>
        <button className="btn-ghost btn-sm" disabled={busy || !images} onClick={() => run(false)}>Load as batch (waits for approval)</button>
      </div>
      {summary && <p className="text-xs text-muted">Women's garment classes found: {summary}. Men's classes and accessories are skipped.</p>}
      {progress && (
        <div>
          <div className="h-3 overflow-hidden rounded-full bg-line"><div className="h-3 rounded-full bg-brand transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          <p className="mt-1 text-xs text-muted">Loaded {progress.done} of {progress.total}</p>
        </div>
      )}
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}
