import { requireAdmin } from '@/lib/admin';
import { db, must } from '@/lib/db';
import { loadVocab } from '@/lib/vocab';

export const maxDuration = 300;
const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** One-click CSV export of the whole reference dataset, one row per outfit, one column per attribute. */
export async function GET() {
  const a = await requireAdmin();
  if (a.error) return a.error;
  const vocab = await loadVocab(true);
  const brands = new Map((must(await db().from('partner_brands').select('id,name')) as any[]).map((b) => [b.id, b.name]));
  const head = ['id', 'source', 'brand', 'external_id', 'sku', 'name', 'price', 'currency', 'category', 'permalink', 'dataset_label',
    'label_mismatch', 'status', 'reviewed_at', 'image_urls', ...vocab.groups.map((g) => g.key), 'admin_corrected_groups'];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(head.join(',') + '\n'));
      for (let from = 0; ; from += 500) {
        const rows = must(await db().from('reference_outfits')
          .select('*, reference_photos(source_url,storage_path,sort), reference_attributes(group_id,value_id,other_text,admin_corrected)')
          .order('created_at').order('id').range(from, from + 499)) as any[];
        for (const r of rows) {
          const cells = vocab.groups.map((g) => r.reference_attributes.filter((x: any) => x.group_id === g.id)
            .map((x: any) => (x.value_id ? g.values.find((v) => v.id === x.value_id)?.value : x.other_text)).filter(Boolean).join('; '));
          const corrected = vocab.groups.filter((g) => r.reference_attributes.some((x: any) => x.group_id === g.id && x.admin_corrected)).map((g) => g.key).join('; ');
          const images = r.reference_photos.sort((x: any, y: any) => x.sort - y.sort).map((p: any) => p.source_url ?? `storage:${p.storage_path}`).join(' | ');
          controller.enqueue(encoder.encode([r.id, r.source, brands.get(r.brand_id) ?? '', r.external_id, r.sku, r.name, r.price, r.currency, r.category,
            r.permalink, r.dataset_label, r.label_mismatch, r.status, r.reviewed_at, images, ...cells, corrected].map(esc).join(',') + '\n'));
        }
        if (rows.length < 500) break;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="reference-outfits-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
