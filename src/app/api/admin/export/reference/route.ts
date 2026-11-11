import { requireAdmin } from '@/lib/admin';
import { sql } from '@/lib/db';
import { loadVocab } from '@/lib/vocab';

export const maxDuration = 300;
const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** One-click CSV export of the whole reference dataset, one row per outfit, one column per attribute. */
export async function GET() {
  const a = await requireAdmin();
  if (a.error) return a.error;
  const vocab = await loadVocab(true);
  const head = ['id', 'source', 'brand', 'external_id', 'sku', 'name', 'price', 'currency', 'category', 'permalink', 'dataset_label',
    'label_mismatch', 'status', 'reviewed_at', 'image_urls', ...vocab.groups.map((g) => g.key), 'admin_corrected_groups'];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(head.join(',') + '\n'));
      for (let from = 0; ; from += 500) {
        const rows = await sql(
          `select r.*, b.name as brand,
                  coalesce((select string_agg(coalesce(p.source_url, 'stored:' || p.id), ' | ' order by p.sort) from reference_photos p where p.reference_outfit_id = r.id), '') as images,
                  coalesce((select jsonb_agg(jsonb_build_object('group_id', a.group_id, 'value_id', a.value_id, 'other_text', a.other_text, 'admin_corrected', a.admin_corrected) order by a.position)
                            from reference_attributes a where a.reference_outfit_id = r.id), '[]'::jsonb) as attributes
           from reference_outfits r left join partner_brands b on b.id = r.brand_id
           order by r.created_at, r.id limit 500 offset $1`, [from]);
        for (const r of rows) {
          const cells = vocab.groups.map((g) => r.attributes.filter((x: any) => x.group_id === g.id)
            .map((x: any) => (x.value_id ? g.values.find((v) => v.id === x.value_id)?.value : x.other_text)).filter(Boolean).join('; '));
          const corrected = vocab.groups.filter((g) => r.attributes.some((x: any) => x.group_id === g.id && x.admin_corrected)).map((g) => g.key).join('; ');
          controller.enqueue(encoder.encode([r.id, r.source, r.brand ?? '', r.external_id, r.sku, r.name, r.price, r.currency, r.category,
            r.permalink, r.dataset_label, r.label_mismatch, r.status, r.reviewed_at, r.images, ...cells, corrected].map(esc).join(',') + '\n'));
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
