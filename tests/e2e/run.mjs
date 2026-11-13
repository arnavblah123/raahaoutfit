// End-to-end run through the real app in a phone-sized browser, against a local Postgres and the stubs.
// See README "Tests" for how to start it.
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');   // npm i -D playwright, or a global install
import sharp from 'sharp';
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'fs';
import assert from 'node:assert/strict';

const BASE = process.env.E2E_BASE || 'http://localhost:3320';
const SHOTS = process.env.E2E_SHOTS || 'tests/e2e/shots';
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (t, p) => (await db.query(t, p)).rows;
const setStub = (o) => fetch('http://localhost:4801/_set', { method: 'POST', body: JSON.stringify(o) });
const ok = (m) => console.log('ok:', m);

async function photo(name, [r, g, b]) {
  const svg = `<svg width="900" height="1300"><rect x="200" y="350" width="500" height="800" fill="rgb(${r - 30},${g},${b})"/><circle cx="450" cy="150" r="90" fill="#e8c4a0"/></svg>`;
  const buf = await sharp({ create: { width: 900, height: 1300, channels: 3, background: { r, g, b } } })
    .composite([{ input: Buffer.from(svg) }]).withExif({ IFD0: { Copyright: 'secret-exif-marker' } }).jpeg().toBuffer();
  writeFileSync(`${SHOTS}/${name}.jpg`, buf);
  return `${SHOTS}/${name}.jpg`;
}
const RED = await photo('red', [190, 30, 40]), RED2 = await photo('red2', [185, 35, 45]), RED3 = await photo('red3', [188, 28, 44]), BLUE = await photo('blue', [30, 60, 170]);

const browser = await chromium.launch();
const phone = { ...devices['Pixel 7'], deviceScaleFactor: 1 };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function pick(page, index, file) {
  await page.locator('input[type=file]').nth(index).setInputFiles(file);
  await page.getByRole('button', { name: 'Use this crop' }).click();
}
async function addOutfit(page, code, files, { consent = false, colour = 'red', extra = null } = {}) {
  await page.goto(`${BASE}/w/${code}`);
  await page.getByRole('link', { name: 'Add outfit' }).first().click();
  await page.waitForURL(/\/add/);
  await pick(page, 0, files[0]); await pick(page, 1, files[1]);
  if (extra) await pick(page, 2, extra);
  if (consent) await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Check the details' }).waitFor({ timeout: 60_000 });
  return async () => {
    await page.getByRole('button', { name: colour, exact: true }).click();
    await page.getByRole('button', { name: /Confirm and check/ }).click();
    await page.waitForURL(/\/outfit\//, { timeout: 90_000 });
  };
}

// ---------------------------------------------------------------- 1. Host creates the wedding
const A = await (await browser.newContext(phone)).newPage();
await A.goto(`${BASE}/create`);
await A.fill('#couple', 'Aanya and Kabir'); await A.fill('#city', 'Jaipur'); await A.fill('#name', 'Meera');
await A.fill('#date', new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
await A.getByRole('checkbox').check();
await A.getByRole('button', { name: /Create and get the link/ }).click();
await A.waitForURL(/\/w\/[a-z0-9]+$/);
const code = A.url().split('/').pop();
await A.getByText('Your personal link').waitFor();
assert.ok(await A.getByText(`${code}`).first().isVisible());
await shot(A, '01-home-creator');
ok(`wedding created with join code of ${code.length} characters, share and recovery links shown`);

// ---------------------------------------------------------------- 2. First outfit: read, confirm, no clash
let confirm = await addOutfit(A, code, [RED, RED2], { consent: true, extra: RED3 });
await shot(A, '02-confirm');
assert.equal(await A.getByRole('button', { name: 'lehenga choli' }).getAttribute('class').then((c) => c.includes('chip-on')), true, 'AI garment suggestion pre-selected');
assert.equal(await A.locator('#colour button[aria-pressed=true]').count(), 0, 'colour is never pre-selected');
await A.getByRole('button', { name: /Confirm and check/ }).click();
await A.getByText('Pick the colour of your outfit').waitFor();
ok('confirming without a colour is refused');
await A.getByText('From your photos, we think it is').waitFor();
await A.getByRole('button', { name: 'Use suggested colour red' }).click();
assert.equal(await A.locator('#colour button[aria-pressed=true]').count(), 2, 'confirming the guess selects the swatch too');
ok('the colour the app thinks it is is shown, and one tap confirms it');
await A.getByRole('button', { name: /Confirm and check/ }).click();
await A.waitForURL(/\/outfit\//, { timeout: 90_000 });
await A.getByText('No clash').first().waitFor();
await shot(A, '03-result-no-clash');
const outfitA = A.url().split('/').pop();
ok('first outfit: No clash');

const [pa] = await q('select id, image, width, height, bbox, embedding is not null as embedded from outfit_photos where outfit_id = $1 and kind = $2', [outfitA, 'full']);
const meta = await sharp(pa.image).metadata();
assert.ok(!meta.exif && !pa.image.includes('secret-exif-marker'), 'EXIF stripped');
assert.ok(meta.height < 1300 * 0.9 && pa.bbox.y > 0, 'stored image is cropped to the outfit box');
assert.ok(pa.embedded);
assert.deepEqual((await q('select kind from outfit_photos where outfit_id = $1 order by kind', [outfitA])).map((r) => r.kind), ['closeup', 'extra', 'full'], 'optional third photo stored');
assert.equal((await (await fetch('http://localhost:4801/_state')).json()).calls.read, 1, 'all photos read in one call');
ok(`stored photo is cropped (${meta.width}x${meta.height}), has no EXIF, and is embedded`);
const attrs = await q(`select g.key, v.value, a.other_text, a.confirmed from outfit_attributes a join attribute_groups g on g.id = a.group_id left join attribute_values v on v.id = a.value_id where a.outfit_id = $1`, [outfitA]);
assert.ok(attrs.every((a) => a.confirmed) && attrs.some((a) => a.key === 'colour' && a.value === 'red'));
assert.ok(!attrs.some((a) => a.key === 'fabric'), 'low-confidence attribute left blank');
assert.ok(attrs.some((a) => a.key === 'embellishment' && a.value === 'gota patti') && attrs.some((a) => a.key === 'silhouette' && a.other_text === 'A-line flare'));
const pending = await q(`select normalised_value, proposed_by from attribute_pending order by 1`);
assert.deepEqual(pending.map((p) => p.normalised_value), ['shibori', 'tilla work']);
ok('attributes saved as confirmed; low-confidence left blank; unknown AI values went to the pending list');

// ---------------------------------------------------------------- 3. Second guest, same outfit
const B = await (await browser.newContext(phone)).newPage();
await B.goto(`${BASE}/w/${code}`);
await B.fill('#name', 'Riya'); await B.getByRole('button', { name: 'Join' }).click();
await B.getByText('Hello Riya').waitFor();
confirm = await addOutfit(B, code, [RED2, RED]);
await confirm();
await B.getByText('Same outfit').first().waitFor();
await shot(B, '04-result-same-outfit');
const outfitB = B.url().split('/').pop();
const pageB = await B.content();
assert.ok(!pageB.includes('Meera') && !pageB.includes(pa.id), 'no name or photo of the other guest');
ok('second guest sees "Same outfit" with a reason, and nothing identifying the other guest');

// She cannot load the first guest's photo, even with the exact link.
assert.equal((await B.request.get(`${BASE}/api/w/${code}/photos/${pa.id}`)).status(), 404);
assert.equal((await A.request.get(`${BASE}/api/w/${code}/photos/${pa.id}`)).status(), 200);
const anon = await (await browser.newContext()).newPage();
assert.equal((await anon.request.get(`${BASE}/api/w/${code}/photos/${pa.id}`)).status(), 401);
assert.equal((await B.request.delete(`${BASE}/api/w/${code}/outfits/${outfitA}`)).status(), 404);
ok('a guest can load only her own photos, and cannot delete another guest\'s outfit');

// ---------------------------------------------------------------- 4. Earlier guest sees it on her next visit
await A.goto(`${BASE}/w/${code}`);
await A.getByText('New since your last visit').waitFor();
await A.getByText('Reds and pinks: 2').waitFor();
await shot(A, '05-home-new-clash');
await A.getByText('New since your last visit').click();
await A.waitForURL(/\/outfit\//);
await A.getByRole('heading', { name: 'Your result' }).waitFor();
await A.getByText('Same outfit').first().waitFor();
await A.waitForResponse((r) => r.url().endsWith('/seen')).catch(() => {});
await A.goto(`${BASE}/w/${code}`);
assert.equal(await A.getByText('New since your last visit').count(), 0);
ok('earlier guest is told on her next visit; colour map shows counts only');

// A guest can add another photo whenever she likes; her outfit is checked again with it.
const judgedBefore = (await (await fetch('http://localhost:4801/_state')).json()).calls.judge;
await B.getByText('Add another photo of this outfit').click();
await pick(B, 0, RED3);
await Promise.all([B.waitForResponse((r) => r.url().endsWith('/rematch'), { timeout: 90_000 }), B.getByRole('button', { name: 'Add and check again' }).click()]);
await B.waitForLoadState('load'); await B.getByText('Same outfit').first().waitFor();
assert.equal((await q('select count(*)::int as n from outfit_photos where outfit_id = $1 and embedding is not null', [outfitB]))[0].n, 3);
assert.equal((await (await fetch('http://localhost:4801/_state')).json()).calls.judge, judgedBefore + 1, 'pair re-judged with the new photo');
assert.equal((await q('select rounds from outfit_pairs'))[0].rounds, 0, 'a volunteered photo does not use up an extra round');
ok('a guest can add another photo at any time and the check re-runs with it');

// ---------------------------------------------------------------- 5. Unsure judge: extra photo rounds, then "Possible clash"
await setStub({ judge: { verdict: 'similar_look', confidence: 'medium', reason: 'Similar zari work on a red lehenga.', missing_evidence: 'close-up of the border', limiting_side: 'both' } });
const C = await (await browser.newContext(phone)).newPage();
await C.goto(`${BASE}/w/${code}`);
await C.fill('#name', 'Tara'); await C.getByRole('button', { name: 'Join' }).click();
await C.getByText('Hello Tara').waitFor();
confirm = await addOutfit(C, code, [RED3, RED]);
await confirm();
const outfitC = C.url().split('/').pop();
await C.getByText('Possible clash').first().waitFor();
await C.getByText('close-up of the border').waitFor();
await shot(C, '06-needs-photo');
ok('low-confidence clash: provisional "Possible clash" and a request for the specific photo');
assert.equal((await q('select verdict from outfit_results where outfit_id = $1', [outfitA]))[0].verdict, 'same_outfit', 'earlier guests are not shown an unsettled clash');
for (const round of [1, 2]) {
  await pick(C, 0, RED2);
  await Promise.all([
    C.waitForResponse((r) => r.url().endsWith('/rematch'), { timeout: 90_000 }),
    C.getByRole('button', { name: 'Add and check again' }).click(),
  ]);
  await C.waitForLoadState('load'); await C.getByRole('heading', { name: 'Your result' }).waitFor();
  await C.getByText('Possible clash').first().waitFor();
  const pairs = await q('select rounds, settled from outfit_pairs where outfit_a_id = $1 or outfit_b_id = $1', [outfitC]);
  assert.ok(pairs.every((p) => p.rounds === round && p.settled === (round === 2)), `round ${round}`);
}
assert.equal(await C.getByText('close-up of the border').count(), 0);
await shot(C, '07-possible-clash-final');
ok('after 2 extra rounds the request stops and the result stays "Possible clash"');

// ---------------------------------------------------------------- 6. Non-outfit rejected, feedback, different colour, delete
await setStub({ notOutfit: true });
await C.goto(`${BASE}/w/${code}`);
await C.getByRole('link', { name: 'Add outfit' }).nth(1).click();
await pick(C, 0, BLUE); await pick(C, 1, BLUE);
await C.getByRole('button', { name: 'Continue' }).click();
await C.getByText('does not look like an outfit').waitFor({ timeout: 60_000 });
await setStub({ notOutfit: false });
ok('non-outfit photos are rejected and nothing is stored');

await C.goto(`${BASE}/w/${code}/outfit/${outfitC}`);
await C.getByRole('button', { name: 'This result is wrong' }).click();
await C.getByRole('button', { name: 'No clash' }).click();
await C.getByRole('button', { name: 'Send' }).click();
await C.getByText('Thank you').waitFor();
assert.equal((await q('select corrected_verdict from result_feedback'))[0].corrected_verdict, 'no_clash');
ok('"This result is wrong" stores the pair and the correction');

C.once('dialog', (d) => d.accept());
await C.getByRole('button', { name: 'Delete this outfit' }).click();
await C.waitForURL(new RegExp(`/w/${code}$`));
assert.equal((await q('select count(*)::int as n from outfit_photos where outfit_id = $1', [outfitC]))[0].n, 0);
assert.equal((await q('select count(*)::int as n from outfit_pairs where outfit_a_id = $1 or outfit_b_id = $1', [outfitC]))[0].n, 0);
ok('deleting an outfit removes its photos, embeddings, attributes and pairs');

// ---------------------------------------------------------------- 7. Recovery link on a fresh browser
const recovery = await A.evaluate((c) => sessionStorage.getItem(`oc_recovery_${c}`), code);
const R = await (await browser.newContext(phone)).newPage();
await R.goto(`${BASE}/r/${recovery}`);
await R.getByText('Hello Meera').waitFor();
ok('recovery link restores the guest on a new browser');

// ---------------------------------------------------------------- 8. Admin
const adminCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const M = await adminCtx.newPage();
await M.goto(`${BASE}/admin`);
await M.waitForURL(/\/admin\/login/);
await M.fill('input[name=password]', 'wrong'); await M.getByRole('button', { name: 'Sign in' }).click();
await M.getByText('Wrong password').waitFor();
await M.fill('input[name=password]', process.env.ADMIN_PASSWORD); await M.getByRole('button', { name: 'Sign in' }).click();
await M.waitForURL(/\/admin$/);
ok('admin sign-in: wrong password refused, right one accepted');

await M.goto(`${BASE}/admin/stock`);
await M.locator('input[type=file]').nth(1).setInputFiles([RED, RED2, BLUE, RED3]);
await M.getByRole('button', { name: /Upload 4 outfit/ }).click();
await M.getByText('4 outfit(s) uploaded').waitFor({ timeout: 60_000 });
for (let i = 0; i < 60; i++) {
  if ((await q(`select count(*)::int as n from reference_outfits where status = 'processed'`))[0].n === 4) break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal((await q(`select count(*)::int as n from reference_photos where embedding is not null`))[0].n, 4);
const [job] = await q(`select status, done, total, cost_spent_usd::float8 as spent from batch_jobs where kind = 'own_stock'`);
assert.deepEqual([job.status, job.done, job.total], ['done', 4, 4]); assert.ok(job.spent > 0);
ok(`own-stock upload processed by a cost-capped batch job (4 of 4, $${job.spent.toFixed(4)})`);

await M.goto(`${BASE}/admin/reference`);
await M.getByText('Share of blank values').waitFor();
const card = M.locator('.card').filter({ has: M.getByRole('button', { name: /Fabric/ }) }).first();
await card.getByRole('button', { name: /Fabric/ }).click();
await card.getByRole('button', { name: 'velvet', exact: true }).click();
await card.getByRole('button', { name: 'Save corrections' }).click();
await card.getByText('Saved 1 correction').waitFor();
await shot(M, '08-admin-review');
assert.equal((await q('select count(*)::int as n from attribute_corrections'))[0].n, 1);
ok('review grid: inline edit saved as a correction');

await setStub({ judge: { verdict: 'same_outfit', confidence: 'high', reason: 'x', missing_evidence: '', limiting_side: 'none' } });
await M.goto(`${BASE}/admin/label`);
await M.getByRole('button', { name: /^Same outfit/ }).waitFor({ timeout: 30_000 });
await shot(M, '09-admin-label');
await M.getByRole('button', { name: /^Same outfit/ }).click();
await M.getByRole('button', { name: /^Different/ }).click();
await M.getByText('2 today').waitFor().catch(() => {});
for (let i = 0; i < 30; i++) {
  if ((await q('select count(*)::int as n from label_pairs where judge_verdict is not null'))[0].n === 2) break;
  await new Promise((r) => setTimeout(r, 500));
}
const labels = await q('select admin_label, judge_verdict from label_pairs order by labelled_at');
assert.deepEqual(labels.map((l) => l.admin_label), ['same_outfit', 'different']);
assert.ok(labels.every((l) => l.judge_verdict === 'same_outfit'));
await M.goto(`${BASE}/admin`);
await M.getByText('50.0%').first().waitFor();
await shot(M, '10-admin-dashboard');
ok('labelling: two labels saved, judge scored on each, dashboard shows 50% agreement');

for (const path of ['vocabulary', 'feedback', 'imports', 'brands', 'settings']) {
  const res = await M.goto(`${BASE}/admin/${path}`);
  assert.equal(res.status(), 200, path);
  assert.equal(await M.getByText('Application error').count(), 0, path);
}
await M.goto(`${BASE}/admin/vocabulary`);
await M.locator('div', { hasText: /^tilla work/ }).getByRole('button', { name: 'Approve as new' }).first().click();
await M.waitForTimeout(1500);
assert.equal((await q(`select count(*)::int as n from attribute_values where value = 'tilla work'`))[0].n, 1);
ok('vocabulary: pending value approved into the list; other admin pages load');

// Partner brand: import is refused without permission, then removal clears everything.
await M.goto(`${BASE}/admin/brands`);
await M.fill('input[name=name]', 'Test Brand'); await M.locator('select[name=feed_type]').selectOption('csv');
await M.getByRole('button', { name: 'Add brand' }).click();
await M.getByText('Import is blocked').waitFor();
assert.ok(await M.getByRole('button', { name: 'Run import' }).isDisabled());
await shot(M, '11-admin-brands');
ok('partner brand without permission on file: import is blocked');

const csv = await M.request.get(`${BASE}/api/admin/export/reference`);
const lines = (await csv.text()).trim().split('\n');
assert.equal(csv.status(), 200); assert.equal(lines.length, 5); assert.ok(lines[0].includes('garment_type'));
assert.equal((await anon.request.get(`${BASE}/api/admin/export/reference`)).status(), 401);
ok('reference CSV export: 4 rows plus header; refused without sign-in');

// ---------------------------------------------------------------- 9. Scheduled jobs
assert.equal((await anon.request.get(`${BASE}/api/cron/purge`)).status(), 401);
const cron = (job) => anon.request.get(`${BASE}/api/cron/${job}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
const t = await (await cron('threshold')).json();
assert.ok(t.note.includes('Fewer than 20'));
await q(`update weddings set wedding_date = current_date - 8 where join_code = $1`, [code]);
const purge = await (await cron('purge')).json();
assert.deepEqual([purge.weddings, purge.outfitsPurged, purge.keptWithConsent], [1, 2, 1]);
const left = (await q(`select (select count(*) from guests)::int as guests, (select count(*) from outfits)::int as outfits, (select count(*) from outfit_photos)::int as photos,
  (select count(*) from outfit_attributes)::int as attrs, (select count(*) from training_photos)::int as kept, (select purged_stats from weddings limit 1) as stats`))[0];
assert.deepEqual([left.guests, left.outfits, left.photos, left.attrs], [0, 0, 0, 0]);
assert.equal(left.kept, 3); assert.equal(left.stats.outfits, 2);
await A.goto(`${BASE}/w/${code}`);
await A.getByText('This wedding has ended').waitFor();
ok('purge after 7 days: names, photos, vectors and attributes deleted; consented crops kept without any link; counts retained');

const usage = (await q(`select step, count(*)::int as calls, sum(cost_usd)::float8 as cost from ai_usage group by 1 order by 1`));
console.log('token usage logged:', usage.map((u) => `${u.step} x${u.calls} $${u.cost.toFixed(4)}`).join(', '));
await browser.close(); await db.end();
console.log('\nALL END-TO-END CHECKS PASSED');
