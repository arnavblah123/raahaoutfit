'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextLabelPairs, submitLabel, type Card, type LabelTask } from '@/app/admin/actions';

const BUTTONS: [string, string, string][] = [
  ['same_outfit', 'Same outfit', 'bg-[#8c2a12] text-white'],
  ['same_design_diff_colour', 'Same design, different colour', 'bg-[#b4641a] text-white'],
  ['similar_look', 'Similar look', 'bg-[#b89a1d] text-white'],
  ['different', 'Different', 'bg-[#2f7d57] text-white'],
];

function Side({ c }: { c: Card }) {
  const [i, setI] = useState(0);
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <button type="button" className="block w-full" onClick={() => setI((i + 1) % Math.max(1, c.images.length))}>
        {c.images.length ? <img src={c.images[i]} alt="" draggable={false} className="aspect-[3/4] w-full rounded-xl object-cover" />
          : <span className="flex aspect-[3/4] w-full items-center justify-center rounded-xl bg-line text-sm text-muted">No photo</span>}
      </button>
      {c.images.length > 1 && <p className="text-center text-xs text-muted">Tap the photo for the next one ({i + 1}/{c.images.length})</p>}
      <dl className="space-y-0.5 text-xs">
        {Object.entries(c.attributes).slice(0, 8).map(([k, v]) => (
          <div key={k}><dt className="inline text-muted">{k}: </dt><dd className="inline capitalize">{v.join(', ')}</dd></div>
        ))}
      </dl>
    </div>
  );
}

export function Labeller({ initialCounts }: { initialCounts: { total: number; today: number } }) {
  const [queue, setQueue] = useState<LabelTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState(initialCounts);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const fetching = useRef(false);

  const refill = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const more = await nextLabelPairs(10);
      setQueue((q) => {
        const seen = new Set(q.map((t) => t.left.id + t.right.id));
        return [...q, ...more.filter((t) => !seen.has(t.left.id + t.right.id))];
      });
    } catch (e) { setError(String(e)); }
    fetching.current = false; setLoading(false);
  }, []);
  useEffect(() => { refill(); }, [refill]);

  const current = queue[0];
  const answer = useCallback(async (label: string) => {
    if (!current) return;
    setQueue((q) => q.slice(1)); setDrag(0);
    setCounts((c) => ({ total: c.total + 1, today: c.today + 1 }));
    const r = await submitLabel({ left: { kind: current.left.kind, id: current.left.id }, right: { kind: current.right.kind, id: current.right.id }, similarity: current.similarity, why: current.why }, label);
    if (!r.ok) { setError(r.error); setCounts((c) => ({ total: c.total - 1, today: c.today - 1 })); }
  }, [current]);
  useEffect(() => { if (!loading && queue.length <= 3) refill(); }, [queue.length, loading, refill]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const b = BUTTONS[Number(e.key) - 1]; if (b) answer(b[0]); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Label pairs</h1>
        <p className="text-sm text-muted"><span className="font-semibold text-ink">{counts.today}</span> today · <span className="font-semibold text-ink">{counts.total}</span> in total</p>
      </div>
      {error && <p className="err">{error}</p>}
      {!current ? (
        <p className="note">{loading ? 'Finding the most useful pairs…' : 'No pairs to label right now. Import reference outfits first, then come back.'}</p>
      ) : (
        <>
          <div
            className="card touch-pan-y select-none"
            style={{ transform: `translateX(${drag}px) rotate(${drag / 40}deg)`, transition: start.current == null ? 'transform .15s' : 'none' }}
            onTouchStart={(e) => { start.current = e.touches[0].clientX; }}
            onTouchMove={(e) => { if (start.current != null) setDrag(e.touches[0].clientX - start.current); }}
            onTouchEnd={() => { const d = drag; start.current = null; if (d > 110) answer('same_outfit'); else if (d < -110) answer('different'); else setDrag(0); }}
          >
            <div className="flex gap-3"><Side key={current.left.id} c={current.left} /><Side key={current.right.id} c={current.right} /></div>
            <p className="mt-2 text-center text-xs text-muted">
              {current.why === 'judge_not_confident' ? 'Picked because the judge was not confident' : 'Picked because it sits near the shortlist threshold'}
              {current.similarity != null ? ` · similarity ${current.similarity.toFixed(3)}` : ''}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {BUTTONS.map(([k, label, cls], i) => (
              <button key={k} className={`rounded-2xl px-3 py-4 text-sm font-medium active:scale-[0.98] ${cls}`} onClick={() => answer(k)}>
                {label}<span className="ml-1 hidden opacity-70 md:inline">({i + 1})</span>
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted">Swipe right for Same outfit, left for Different. On a keyboard, press 1 to 4.</p>
        </>
      )}
    </div>
  );
}
