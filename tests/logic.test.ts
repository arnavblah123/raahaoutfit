import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accuracy } from '../src/lib/accuracy';
import { topKReport } from '../src/lib/evalmath';
import { assertPublicUrl, fetchShopify, fetchWooCommerce, parseCsv, parseCsvFeed } from '../src/lib/feeds';
import { clampBbox } from '../src/lib/images';
import { canonicalClass, labelMismatch } from '../src/lib/indofashion';
import { SEVERITY, displayFor } from '../src/lib/pipeline/match';
import { findValue } from '../src/lib/vocab';
import { costOf } from '../src/lib/ai';
import { normaliseVector } from '../src/lib/embed/server';

const pair = (o: Partial<{ verdict: string; confidence: string; settled: boolean; limiting_outfit_id: string | null }>) =>
  ({ verdict: 'same_outfit', confidence: 'high', settled: true, limiting_outfit_id: null, ...o });

test('result shown to each guest', () => {
  assert.deepEqual(displayFor(pair({ verdict: 'no_clash' }), 'me', true), { display: null, needsPhoto: false });
  assert.equal(displayFor(pair({}), 'me', false).display, 'same_outfit');
  // Settled without high confidence (extra rounds used up) is only ever a possible clash.
  assert.equal(displayFor(pair({ confidence: 'medium' }), 'me', true).display, 'possible_clash');
  // Unsettled, the later uploader's photos are limiting: she is asked, and sees a provisional result.
  assert.deepEqual(displayFor(pair({ confidence: 'low', settled: false, limiting_outfit_id: 'me' }), 'me', true), { display: 'possible_clash', needsPhoto: true });
  // Unsettled, the earlier guest's photos are limiting: neutral request only, no clash revealed.
  assert.deepEqual(displayFor(pair({ confidence: 'low', settled: false, limiting_outfit_id: 'me' }), 'me', false), { display: null, needsPhoto: true });
  // Unsettled and waiting on the other guest: the earlier guest sees nothing yet.
  assert.deepEqual(displayFor(pair({ confidence: 'low', settled: false, limiting_outfit_id: 'her' }), 'me', false), { display: null, needsPhoto: false });
  assert.ok(SEVERITY.same_outfit > SEVERITY.same_design_diff_colour && SEVERITY.similar_look > SEVERITY.possible_clash);
});

test('accuracy against admin labels', () => {
  const a = accuracy([
    { admin_label: 'same_outfit', judge_verdict: 'same_outfit', similarity: 0.9 },
    { admin_label: 'similar_look', judge_verdict: 'no_clash', similarity: 0.5 },
    { admin_label: 'different', judge_verdict: 'no_clash', similarity: 0.7 },
    { admin_label: 'different', judge_verdict: 'similar_look', similarity: 0.65 },
    { admin_label: 'same_outfit', judge_verdict: null, similarity: 0.8 },
  ], 0.6);
  assert.equal(a.labelled, 5); assert.equal(a.judged, 4);
  assert.equal(a.exactAgreement, 0.5);
  assert.equal(a.clashRecall, 0.5); assert.equal(a.clashPrecision, 0.5);
  assert.equal(a.shortlistRecall, 2 / 3);
  assert.equal(a.confusion.different.similar_look, 1);
  assert.equal(accuracy([], 0.6).exactAgreement, null);
});

test('top-k evaluation', () => {
  const r = topKReport([
    { set: 'a', file: 'a1', v: [1, 0] }, { set: 'a', file: 'a2', v: [0.9, 0.436] },
    { set: 'b', file: 'b1', v: [0, 1] }, { set: 'b', file: 'b2', v: [0.6, 0.8] }, { set: 'c', file: 'c1', v: [0.7, 0.714] },
  ], 1);
  assert.equal(r.sets, 3); assert.equal(r.queries, 4);
  assert.equal(r.hitAt1, 0.5);     // b1's nearest is b2, a1's is a2; a2 and b2 are nearest to c1 or each other
  assert.equal(r.misses.length, 2);
  assert.equal(topKReport(r.misses.length ? [{ set: 'a', file: 'x', v: [1, 0] }, { set: 'a', file: 'y', v: [1, 0] }] : [], 5).hitAtK, 1);
});

test('csv feed parsing', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\n\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  const p = parseCsvFeed('Name,Image URLs,Price,SKU\n"Red lehenga","https://x.com/1.jpg | https://x.com/2.jpg","₹45,000",RL-1\nNo image,,,\n');
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].images, ['https://x.com/1.jpg', 'https://x.com/2.jpg']);
  assert.equal(p[0].price, 45000); assert.equal(p[0].external_id, 'RL-1');
  assert.throws(() => parseCsvFeed('name,price\nx,1\n'), /image_urls/);
});

test('feed URLs must be public https', () => {
  for (const bad of ['http://brand.com/products.json', 'https://localhost/x', 'https://10.0.0.1/x', 'https://[::1]/x', 'https://db.internal/x'])
    assert.throws(() => assertPublicUrl(bad));
  assert.equal(assertPublicUrl('https://brand.com/products.json').hostname, 'brand.com');
});

test('WooCommerce and Shopify feeds are mapped', async () => {
  const real = globalThis.fetch;
  const pages: Record<string, unknown> = {
    'woo:1': [{ id: 7, name: 'Ivory <b>Anarkali</b>', sku: 'AK7', permalink: 'https://shop.in/p/7', description: '<p>Hand &amp; zari</p>',
      prices: { price: '4500000', currency_code: 'INR', currency_minor_unit: 2 }, images: [{ src: 'https://shop.in/7.jpg' }], categories: [{ name: 'Anarkali' }] }],
    'shopify:1': { products: [{ id: 9, title: 'Sharara', handle: 'sharara', body_html: '<p>Mirror work</p>', product_type: 'Sets',
      variants: [{ price: '18999.00', sku: 'S9' }], images: [{ src: 'https://b.com/9.jpg' }] }] },
  };
  globalThis.fetch = (async (u: URL) => {
    const key = `${u.pathname.includes('wc/store') ? 'woo' : 'shopify'}:${u.searchParams.get('page')}`;
    return new Response(JSON.stringify(pages[key] ?? []), { status: 200 });
  }) as any;
  try {
    const [w] = await fetchWooCommerce('https://shop.in/wp-json/wc/store/v1/products');
    assert.deepEqual({ ...w, description: undefined }, { external_id: '7', sku: 'AK7', name: 'Ivory Anarkali', price: 45000, currency: 'INR',
      description: undefined, permalink: 'https://shop.in/p/7', category: 'Anarkali', images: ['https://shop.in/7.jpg'] });
    assert.equal(w.description, 'Hand & zari');
    const [s] = await fetchShopify('https://b.com/products.json');
    assert.equal(s.permalink, 'https://b.com/products/sharara'); assert.equal(s.price, 18999); assert.equal(s.category, 'Sets');
  } finally { globalThis.fetch = real; }
});

test('IndoFashion classes', () => {
  assert.equal(canonicalClass('Women Kurta'), 'women_kurta');
  assert.equal(canonicalClass('women_kurta'), 'women_kurta');
  assert.equal(canonicalClass('Leggings & Salwar'), 'leggings_and_salwar');
  for (const skipped of ['Men Kurta', 'kurta_men', 'Nehru Jacket', 'Sherwani', 'Men Mojari', 'Women Mojari', 'Dupatta', 'mojaris_women'])
    assert.equal(canonicalClass(skipped), null, skipped);
  assert.equal(labelMismatch('Saree', ['drape saree']), false);
  assert.equal(labelMismatch('Lehenga', ['saree']), true);
  assert.equal(labelMismatch('Lehenga', []), null);       // AI left it blank: not comparable
  assert.equal(labelMismatch('Blouse', ['saree']), null);
});

test('bounding boxes never pad upwards and fall back when broken', () => {
  const b = clampBbox({ x: 0.2, y: 0.3, w: 0.5, h: 0.6 });
  assert.equal(b.y, 0.3); assert.ok(b.x < 0.2 && b.x + b.w > 0.7 && b.y + b.h > 0.9);
  assert.deepEqual(clampBbox({ x: 0.4, y: 0.4, w: 0.01, h: 0.01 }), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(clampBbox(undefined), { x: 0, y: 0, w: 1, h: 1 });
  const edge = clampBbox({ x: -1, y: 0.2, w: 5, h: 5 });
  assert.ok(edge.x >= 0 && edge.x + edge.w <= 1 && edge.y + edge.h <= 1);
});

test('vocabulary lookup, cost and vectors', () => {
  const g = { id: 'g', key: 'embellishment', label: 'E', free_text: false, values: [{ id: '1', value: 'pearl (moti)', family_id: null, hex: null }, { id: '2', value: 'Banarasi brocade', family_id: null, hex: null }] };
  assert.equal(findValue(g, ' Pearl ')?.id, '1');
  assert.equal(findValue(g, 'banarasi  brocade')?.id, '2');
  assert.equal(findValue(g, 'sequin'), undefined);
  assert.equal(costOf('claude-sonnet-5-5', 1_000_000, 100_000), 3);
  assert.equal(costOf('unknown-model', 5, 5), 0);
  assert.equal(normaliseVector([1, 2, 3]), null);
  const v = normaliseVector(Array.from({ length: 768 }, () => 2))!;
  assert.ok(Math.abs(v.reduce((s, n) => s + n * n, 0) - 1) < 1e-9);
});
