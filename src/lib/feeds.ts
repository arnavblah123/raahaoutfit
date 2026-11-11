/** Product feed readers: WooCommerce Store API, Shopify products.json, and CSV. */
export type FeedProduct = {
  external_id: string; sku: string | null; name: string; price: number | null; currency: string | null;
  description: string | null; permalink: string | null; category: string | null; images: string[];
};

const stripHtml = (s: unknown) => typeof s === 'string'
  ? s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 2000) : null;

/** Feed URLs are typed in by an admin; still refuse anything that is not a public https address. */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  const h = u.hostname.toLowerCase();
  const isPrivate = h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':') ||
    /^(\d+\.){3}\d+$/.test(h);
  if (u.protocol !== 'https:' || isPrivate) throw new Error('Feed URL must be a public https address');
  return u;
}

async function getJson(url: URL) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json', 'user-agent': 'outfit-clash-importer' } });
  if (!res.ok) throw new Error(`Feed returned ${res.status} for ${url.pathname}`);
  return res.json();
}

/** e.g. https://raahabyarchanabansal.in/wp-json/wc/store/v1/products */
export async function fetchWooCommerce(feedUrl: string, maxPages = 30): Promise<FeedProduct[]> {
  const base = assertPublicUrl(feedUrl);
  const out: FeedProduct[] = [];
  for (let page = 1; page <= maxPages; page++) {
    base.searchParams.set('per_page', '100'); base.searchParams.set('page', String(page));
    const items = await getJson(base);
    if (!Array.isArray(items) || !items.length) break;
    for (const p of items) {
      const minor = Number(p.prices?.currency_minor_unit ?? 2);
      const price = p.prices?.price != null && p.prices.price !== '' ? Number(p.prices.price) / 10 ** minor : null;
      out.push({
        external_id: String(p.id), sku: p.sku || null, name: stripHtml(p.name) ?? '', price: Number.isFinite(price) ? price : null,
        currency: p.prices?.currency_code ?? null, description: stripHtml(p.description || p.short_description),
        permalink: p.permalink ?? null, category: p.categories?.[0]?.name ? stripHtml(p.categories[0].name) : null,
        images: (p.images ?? []).map((i: any) => i.src).filter((s: any) => typeof s === 'string'),
      });
    }
    if (items.length < 100) break;
  }
  return out;
}

/** e.g. https://brand.com/products.json */
export async function fetchShopify(feedUrl: string, maxPages = 30): Promise<FeedProduct[]> {
  const base = assertPublicUrl(feedUrl);
  const out: FeedProduct[] = [];
  for (let page = 1; page <= maxPages; page++) {
    base.searchParams.set('limit', '250'); base.searchParams.set('page', String(page));
    const items = (await getJson(base))?.products;
    if (!Array.isArray(items) || !items.length) break;
    for (const p of items) {
      const v = p.variants?.[0];
      out.push({
        external_id: String(p.id), sku: v?.sku || null, name: p.title ?? '', price: v?.price != null ? Number(v.price) : null,
        currency: null, description: stripHtml(p.body_html), permalink: p.handle ? `${base.origin}/products/${p.handle}` : null,
        category: p.product_type || null, images: (p.images ?? []).map((i: any) => i.src).filter((s: any) => typeof s === 'string'),
      });
    }
    if (items.length < 250) break;
  }
  return out;
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/**
 * CSV columns (header row required, any order): name, image_urls (or image_url), and optionally
 * external_id, sku, price, currency, permalink, description, category.
 * Several image links go in one cell separated by | or ; or spaces.
 */
export function parseCsvFeed(text: string): FeedProduct[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one product');
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (r: string[], ...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && r[i]?.trim()) return r[i].trim(); } return ''; };
  if (!head.some((h) => ['image_urls', 'image_url', 'images', 'image'].includes(h))) throw new Error('The CSV needs an image_urls column');
  return rows.slice(1).map((r, i) => {
    const images = col(r, 'image_urls', 'image_url', 'images', 'image').split(/[|;\s]+/).filter((u) => /^https:\/\//i.test(u));
    const price = Number(col(r, 'price').replace(/[^\d.]/g, ''));
    return {
      external_id: col(r, 'external_id', 'id', 'sku') || `row-${i + 1}`, sku: col(r, 'sku') || null, name: col(r, 'name', 'title'),
      price: price > 0 ? price : null, currency: col(r, 'currency') || null, description: col(r, 'description') || null,
      permalink: col(r, 'permalink', 'url', 'link') || null, category: col(r, 'category') || null, images,
    };
  }).filter((p) => p.images.length);
}
