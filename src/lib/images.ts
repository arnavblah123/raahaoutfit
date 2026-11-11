import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 2_000_000;   // per photo, after the browser has compressed it
export type Bbox = { x: number; y: number; w: number; h: number };

const open = (buf: Buffer) => sharp(buf, { failOn: 'none', limitInputPixels: 40_000_000 }).rotate();

/** Decode an upload and re-encode it. Throws if it is not an image. Output carries no metadata. */
export async function normalise(buf: Buffer) {
  const out = await open(buf).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 }).toBuffer({ resolveWithObject: true });
  return { jpeg: out.data, width: out.info.width, height: out.info.height };
}

/** Smaller copy for the vision models. */
export async function forModel(jpeg: Buffer, edge = 1024) {
  return sharp(jpeg).resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

export function clampBbox(b: Bbox | undefined): Bbox {
  const ok = b && [b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n));
  if (!ok) return { x: 0, y: 0, w: 1, h: 1 };
  // Pad the sides and bottom a little; never pad upwards, so the face stays out.
  const pad = 0.03;
  const x = Math.max(0, Math.min(1, b!.x) - pad);
  const y = Math.max(0, Math.min(1, b!.y));
  const right = Math.min(1, b!.x + b!.w + pad);
  const bottom = Math.min(1, b!.y + b!.h + pad);
  const w = right - x, h = bottom - y;
  // A tiny or broken box means the model failed to localise; keep the guest's own crop.
  if (w < 0.15 || h < 0.15) return { x: 0, y: 0, w: 1, h: 1 };
  return { x, y, w, h };
}

/** Crop to the outfit box and strip all metadata (sharp drops EXIF unless asked to keep it). */
export async function cropToBbox(jpeg: Buffer, width: number, height: number, bbox: Bbox) {
  const left = Math.round(bbox.x * width), top = Math.round(bbox.y * height);
  const w = Math.max(1, Math.min(width - left, Math.round(bbox.w * width)));
  const h = Math.max(1, Math.min(height - top, Math.round(bbox.h * height)));
  const out = await sharp(jpeg).extract({ left, top, width: w, height: h }).jpeg({ quality: 86 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: out.data, width: out.info.width, height: out.info.height };
}
