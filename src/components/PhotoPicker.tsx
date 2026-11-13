'use client';
import { useRef, useState } from 'react';
import ReactCrop, { type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

const MAX_EDGE = 1600;
const MAX_BYTES = 800_000;   // up to five photos go in one request

/** Draw the chosen crop to a canvas. Re-encoding also drops EXIF (location, device) before upload. */
async function cropAndCompress(img: HTMLImageElement, c: PercentCrop): Promise<Blob> {
  const sx = (c.x / 100) * img.naturalWidth, sy = (c.y / 100) * img.naturalHeight;
  const sw = (c.width / 100) * img.naturalWidth, sh = (c.height / 100) * img.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const q of [0.85, 0.75, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    // Still too big (very detailed photo): shrink the picture and try again.
    const smaller = document.createElement('canvas');
    smaller.width = Math.round(canvas.width * 0.75); smaller.height = Math.round(canvas.height * 0.75);
    smaller.getContext('2d')!.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas.width = smaller.width; canvas.height = smaller.height;
    canvas.getContext('2d')!.drawImage(smaller, 0, 0);
  }
  throw new Error('Could not prepare the photo');
}

export function PhotoPicker({ label, hint, value, onChange }: {
  label: string; hint: string; value: { blob: Blob; preview: string } | null;
  onChange: (v: { blob: Blob; preview: string } | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<PercentCrop>({ unit: '%', x: 5, y: 12, width: 90, height: 85 });
  const [error, setError] = useState('');

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose a photo.'); return; }
    if (file.size > 30_000_000) { setError('That photo is too large.'); return; }
    setError(''); setCrop({ unit: '%', x: 5, y: 12, width: 90, height: 85 });
    setSrc(URL.createObjectURL(file));
  }
  async function done() {
    if (!imgRef.current) return;
    try {
      const blob = await cropAndCompress(imgRef.current, crop);
      if (value) URL.revokeObjectURL(value.preview);
      onChange({ blob, preview: URL.createObjectURL(blob) });
      URL.revokeObjectURL(src!); setSrc(null);
    } catch { setError('We could not read that photo. Try a different one.'); setSrc(null); }
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={pick} />
      <button type="button" onClick={() => input.current?.click()}
        className="flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-white text-center">
        {value
          ? <img src={value.preview} alt={label} className="h-full w-full object-cover" />
          : <span className="px-3"><span className="block text-3xl text-brand">+</span>
              <span className="block font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>}
      </button>
      {value && <button type="button" className="mt-1 w-full text-sm text-muted underline" onClick={() => input.current?.click()}>Change photo</button>}
      {error && <p className="mt-1 text-sm text-warn">{error}</p>}

      {src && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4">
          <p className="mb-3 rounded-xl bg-white p-3 text-sm">
            <span className="font-medium">Crop out your face.</span> Drag the box so it covers only the outfit. A photo of the outfit on a hanger works just as well.
          </p>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <ReactCrop crop={crop} onChange={(_, pc) => setCrop(pc)} minWidth={40} minHeight={40} keepSelection>
              <img ref={imgRef} src={src} alt="Crop" style={{ maxHeight: '62dvh', maxWidth: '100%' }} />
            </ReactCrop>
          </div>
          <div className="mt-3 flex gap-3">
            <button type="button" className="btn-ghost flex-1" onClick={() => { URL.revokeObjectURL(src); setSrc(null); }}>Cancel</button>
            <button type="button" className="btn-primary flex-1" onClick={done}>Use this crop</button>
          </div>
        </div>
      )}
    </div>
  );
}
