import { BrandActions, BrandForm } from '@/components/admin/Buttons';
import { sql } from '@/lib/db';
import { getSettings } from '@/lib/settings';

export default async function Brands() {
  const [s, brands] = await Promise.all([getSettings(), sql(
    `select b.id, b.name, b.feed_type, b.feed_url, b.permission_date, b.permission_note, b.show_in_similar,
            b.permission_file is not null as has_file, b.permission_file_name,
            (select count(*) from reference_outfits r where r.brand_id = b.id and r.status = 'processed') as ready
     from partner_brands b order by b.name`)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Partner brands</h1>
      <p className="text-sm text-muted">A brand's products are imported only when its permission is on file: the date, plus a note or the brand's email. Progress shows on the Imports page.</p>
      {brands.map((b) => {
        const hasPermission = !!b.permission_date && !!(b.permission_note?.trim() || b.has_file);
        return (
          <section key={b.id} className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{b.name}</h2>
              <p className="text-sm text-muted">{b.ready} products ready · {b.feed_type}{hasPermission ? ` · permission on file (${b.permission_date})` : ''}</p>
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
