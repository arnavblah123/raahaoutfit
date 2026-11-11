import { BrandActions, BrandForm } from '@/components/admin/Buttons';
import { db } from '@/lib/db';
import { getSettings } from '@/lib/settings';

export default async function Brands() {
  const [s, brands] = await Promise.all([getSettings(), db().from('partner_brands').select('*').order('name')]);
  const counts = new Map<string, number>();
  for (const b of brands.data ?? []) {
    const { count } = await db().from('reference_outfits').select('id', { count: 'exact', head: true }).eq('brand_id', b.id).eq('status', 'processed');
    counts.set(b.id, count ?? 0);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Partner brands</h1>
      <p className="text-sm text-muted">A brand's products are imported only when its permission is on file: the date, plus a note or the brand's email. Progress shows on the Imports page.</p>
      {(brands.data ?? []).map((b: any) => {
        const hasPermission = !!b.permission_date && !!(b.permission_note?.trim() || b.permission_file_path);
        return (
          <section key={b.id} className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{b.name}</h2>
              <p className="text-sm text-muted">{counts.get(b.id)} products ready · {b.feed_type}{hasPermission ? ` · permission on file (${b.permission_date})` : ''}</p>
            </div>
            <BrandActions brand={b} defaultCap={s.default_import_cost_cap_usd} hasPermission={hasPermission} />
            <details><summary className="cursor-pointer text-sm underline">Edit details and permission</summary><div className="pt-3"><BrandForm brand={b} /></div></details>
          </section>
        );
      })}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Add a brand</h2>
        <BrandForm />
        <p className="text-xs text-muted">CSV columns: name, image_urls (links separated by |), and optionally external_id, sku, price, currency, permalink, description, category.</p>
      </section>
    </div>
  );
}
