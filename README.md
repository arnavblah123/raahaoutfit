# Outfit Clash

Guests of the same wedding add what they plan to wear to each function. Each guest is told, privately, whether someone else at that function is wearing the same or a very similar outfit. She never sees who, and never sees the other photo. It is not a shop: there is no catalogue management, billing or checkout.

- **App:** Next.js (App Router, TypeScript, Tailwind), deployed on Vercel. Mobile-first.
- **Data:** one Neon Postgres database with pgvector. Photos are stored in the database too, so Neon is the only service besides Vercel and the AI provider. Scheduled jobs run on Vercel Cron.
- **AI:** one module (`src/lib/ai`) holds every model call. Model names and keys are environment variables.

## How it works

| Step | What happens | Where |
|---|---|---|
| Read | A small vision model reads all of the outfit's photos together (two required, up to three more optional) and returns attributes with a confidence each, an outfit bounding box that excludes the face, and a not-an-outfit flag. Low-confidence values come back blank. | `src/lib/pipeline/read.ts` |
| Confirm | The guest is shown the colour the app thinks it is and confirms it or picks another from the swatches (never pre-selected), and can edit everything else. Matching runs only after this. | `src/components/AddOutfit.tsx` |
| Shortlist | Both photos are embedded with Marqo-FashionSigLIP and stored in pgvector. Top 5 by cosine similarity in the same function, plus any outfit sharing a garment type and the colour family. | `shortlist_outfits` in `0003_functions.sql` |
| Judge | For each shortlisted pair above the threshold, a stronger vision model sees both outfits' photos and confirmed attributes and returns verdict, confidence, reason and missing evidence. Cached per pair. | `src/lib/pipeline/match.ts` |
| More photos | A clash verdict below high confidence asks for the specific photo named, up to 2 extra rounds, then shows "Possible clash". If the earlier guest's photos are the limit, she gets a neutral "add a clearer photo" request. | `recomputeResult` |

Guests read one table for results, `outfit_results`, which has a verdict and a reason and no link to the other outfit. The pair table is server-only.

## Setup

### 1. Neon

1. In Vercel, open your project's Storage tab and add **Neon**. This creates the database and sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` on the project. (Or create a database at neon.tech and copy both connection strings yourself.)
2. That is all. Every deploy applies the files in `db/migrations` before building (tables, row-level security, SQL functions, seed vocabulary), once each, and enables the `vector` extension itself. To apply them by hand from your own machine, put the two variables in `.env.local` and run `npm run db:migrate`.

### 2. Environment variables

Copy `.env.example` to `.env.local` for local work, and set the same values in Vercel.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string. Used by the app |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string. Used only by `npm run db:migrate` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app, used in share and recovery links |
| `ADMIN_PASSWORD` | Password for `/admin` |
| `SESSION_SECRET` | Long random string that signs the admin session cookie |
| `CRON_SECRET` | Vercel Cron sends it to the scheduled-job routes as a bearer token |
| `ANTHROPIC_API_KEY` | Key for the Read and Judge models |
| `AI_READ_MODEL`, `AI_JUDGE_MODEL`, `AI_VOCAB_MODEL` | Model names. Defaults: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` |
| `AI_READ_EFFORT`, `AI_JUDGE_EFFORT` | Effort level per step (`low`, `medium`, `high`; `none` to omit) |
| `AI_PRICES` | Optional price table override, USD per million tokens: `{"model":[input,output]}` |
| `NEXT_PUBLIC_EMBED_MODE` | `browser` (default) or `server` |
| `NEXT_PUBLIC_EMBED_MODEL`, `NEXT_PUBLIC_EMBED_DTYPE` | Embedding model and ONNX precision. Keep the same values everywhere so vectors are comparable |
| `EMBED_URL`, `EMBED_SECRET` | Optional embedding server (see below) |

### 3. Run

```bash
npm install
```

```bash
npm run dev
```

Deploy by importing the repository into Vercel and setting the environment variables. Allow long-running functions (the confirm route and batch jobs use up to 300 seconds).

## Embeddings: browser first, CPU host as fallback

The app is built to compute guest embeddings on the guest's own phone with transformers.js (`public/embed-worker.js`), which costs nothing to run. The server accepts a browser vector only if it has the right size, and otherwise computes it itself, so a slow or old phone still gets a result.

**Not yet verified:** the build environment could not reach huggingface.co, so the browser path has not been run against the real model files. Before launch, open the upload flow on a phone and confirm in the network tab that the model downloads and the confirm request carries `embeddings`. If the ONNX files for `Marqo/marqo-fashionSigLIP` are not usable in the browser (missing, or too large for mobile data), set `NEXT_PUBLIC_EMBED_MODE=server`.

Reference data, batch jobs and the fallback need a server-side embedder. Two options:

- **In-process:** leave `EMBED_URL` empty and the app runs the ONNX model inside the function. Simple, but the first call after a cold start downloads the model.
- **Small CPU host (recommended for imports):** run `npm run embed:server` on any cheap CPU machine and set `EMBED_URL` and `EMBED_SECRET`.

Imports can also be run from your own machine with the scripts below, which avoids hosting anything.

## Privacy, as implemented

- The upload screen has a crop tool that asks the guest to crop out her face or use a hanger, daylight / no flash / no filters guidance, and a plain-language privacy note.
- The browser re-encodes the photo before upload, which already drops EXIF. The server decodes it again, crops to the outfit bounding box, strips metadata and stores only the crop. The original exists only in memory and is never written anywhere.
- Photos live in the database (`outfit_photos.image`), not in a public file store. There are no photo URLs that work without the guest's cookie.
- **Row-level security:** the app connects as the database owner. For everything a guest reads, the server switches to a restricted role (`app_guest`) inside a transaction and sets her guest id. That role can only `SELECT`, only on guest-facing tables, and the policies return only her own rows and photos. The pair table, reference data, settings and usage logs are not readable by it at all.
- A guest can delete an outfit at any time: photos, embeddings, attributes, pairs and result.
- Seven days after the wedding date a daily job deletes photos, embeddings, attributes and guest names, and keeps anonymous counts. If the guest ticked the consent box, the cropped photos and attributes are kept in separate tables with no link to her or the wedding.
- Admins see guest photos only where the guest consented.
- IndoFashion rows can never be shown to guests: `guest_visible` is a generated column that is false for that source, and "similar styles" filters on it.

## Scheduled jobs

`vercel.json` schedules these on Vercel Cron, which calls `/api/cron/<job>` with `CRON_SECRET`.

| Job | When | What |
|---|---|---|
| `purge` | Daily | Retention deletion; removes uploads abandoned before confirmation |
| `raaha` | Nightly | Pulls the Raaha WooCommerce feed, queues new products under a cost cap, removes products no longer listed |
| `reference-worker` | Daily | Advances running batch jobs |
| `vocab` | Daily | LLM pass that suggests merges for pending vocabulary values |
| `threshold` | Weekly | Recalculates the shortlist threshold from admin labels and logs the change |

Vercel's Hobby plan allows cron jobs once a day at most, which is why the worker is daily. Batch jobs also advance for a few minutes whenever you start or resume one in the admin, and `npm run worker` on your own machine runs them to completion. On a Pro plan you can change the worker schedule to every few minutes.

## Database size

Because photos are stored in Postgres, they count towards Neon's storage. A cropped guest photo is roughly 100 to 250 KB, and guest photos are deleted 7 days after each wedding. Raaha and partner products are not copied (their images stay on the brand's site). Own-stock and IndoFashion images are stored; IndoFashion copies are reduced to 768 px, so 10,000 of them come to several hundred MB. Neon's free plan has a small storage allowance, so the 10,000 batch will likely need a paid plan.

## Reference data

Everything is in `reference_outfits`, separate from guest data, tagged by `source`.

- **Raaha:** nightly job, or `npm run import:raaha -- --cap 1`, or the button on `/admin/imports`.
- **Partner brands:** `/admin/brands`. Shopify `products.json`, WooCommerce Store API, or CSV. The importer refuses to run unless a permission date plus a note or file is on record. One click removes a brand's products, images and embeddings. Each brand has its own switch for appearing in "See similar styles".
- **Own stock:** `/admin/stock`, several photos grouped as one outfit.
- **IndoFashion:** see below.

Every import is a batch job with a cost cap. Jobs are resumable: progress lives in the rows, so a stopped job continues where it left off.

### IndoFashion (waiting for approval)

Nothing has been downloaded. The repository at github.com/IndoFashion/IndoFashion carries an MIT licence for the code; the README states no licence or terms for the dataset itself, and the dataset is obtained by filling in the authors' request form, after which they send a download script. Once you approve and have the files:

```bash
npm run import:indofashion -- --root data/indofashion --metadata data/indofashion/train_data.json --n 500 --cap 2
```

That runs the pilot: 500 images sampled evenly across the women's garment classes (men's classes and accessories skipped), Read and embed on each, and a table of dataset label against the garment type the AI picked. Mismatches are flagged on `/admin/reference`. For the larger batch:

```bash
npm run import:indofashion -- --root data/indofashion --metadata data/indofashion/train_data.json --n 10000 --register-only
```

The batch then waits on `/admin/imports`, which shows the estimated cost from the pilot, lets you set a cap and start it, and shows a progress bar. Process it with:

```bash
npm run worker
```

## Admin

`/admin`, protected by `ADMIN_PASSWORD`. Failed attempts are rate limited.

- **Dashboard:** accuracy of the current pipeline against your labels (updates as you label), cost per outfit, correction rate, threshold history.
- **Review:** grid of reference images with inline-editable attributes. Every correction is saved. Shows label mismatches and the share of blank values per attribute. One-click CSV export of the reference dataset.
- **Label:** two outfits side by side, four buttons, swipe on mobile, running count. Pairs are chosen by uncertainty.
- **Vocabulary, Feedback, Imports, Brands, My stock, Settings.**

Learning uses only guest-confirmed or admin-confirmed data. The three most similar labelled cases are added to the judge prompt as examples; the weekly job recalculates the threshold; `npm run export:training` packages consented photos and confirmed pairs.

## Scripts

| Command | What it does |
|---|---|
| `npm run eval -- --dir eval-sets` | Given folders of same-outfit photo sets, reports how often the true match is in the top 5. Needs no database or AI key |
| `npm run test:pairs -- --dir samples/pairs` | Runs sample pairs through Read, embed and Judge and prints verdicts, token counts and cost. Needs only `ANTHROPIC_API_KEY` |
| `npm run export:training -- --out exports` | Consented photos and admin-confirmed pairs for fine-tuning |
| `npm run db:migrate` | Applies new database migrations |
| `npm run import:raaha`, `npm run import:indofashion`, `npm run worker` | Imports and the batch worker |
| `npm run embed:server` | Embedding server for a CPU host |

Folder layouts are documented at the top of each script.

## Tests

```bash
npm test
```

Unit tests for the result logic, accuracy maths, feed parsers and IndoFashion mapping.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/smoke.sql
```

Database checks on a scratch database with the migrations applied, inside a transaction that is rolled back: shortlist, colour map, similar styles, vocabulary promotion, and what the restricted guest role can and cannot read.

**End to end.** `tests/e2e/run.mjs` drives the real app in a phone-sized browser: create a wedding, three guests upload, clash and extra-photo rounds, photo privacy between guests, feedback, delete, recovery link, the admin pages, CSV export and the retention purge. The AI and embedding services are replaced by local stand-ins (`tests/e2e/stubs.mjs`), so it needs no keys. It needs a scratch Postgres with pgvector and Playwright (`npm i -D playwright`):

```bash
node tests/e2e/stubs.mjs
```

```bash
DATABASE_URL=postgres://... ADMIN_PASSWORD=test SESSION_SECRET=0123456789abcdef0123456789abcdef CRON_SECRET=test ANTHROPIC_API_KEY=stub ANTHROPIC_BASE_URL=http://localhost:4801 EMBED_URL=http://localhost:4802 NEXT_PUBLIC_EMBED_MODE=server NEXT_PUBLIC_APP_URL=http://localhost:3320 sh -c 'npm run db:migrate && npm run build && PORT=3320 npm start'
```

```bash
DATABASE_URL=postgres://... ADMIN_PASSWORD=test CRON_SECRET=test npm run test:e2e
```

## Later

- **Google sign-in:** `guests.auth_user_id` is reserved for it. The policies key on the guest id the server sets, so a signed-in session only needs to resolve to the same guest.
